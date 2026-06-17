// Cloudflare Cron Triggers — wrangler.toml [triggers] crons 항목에서 호출
import { yfRequest } from './utils/crumb.js';
import { sendPush } from './utils/vapid.js';
import { detectSignal } from './utils/indicators.js';
import { fetchChartWithFallback } from './routes/yahoo.js';
import { logError } from './utils/errors.js';
import { loadAlgorithmConfig, loadBlacklist } from './utils/calibration.js';
import { getMarketRegime } from './utils/market.js';
import { paperManageAll } from './utils/paper-engine.js';

// 기본 유니버스 — cron 시그널 분석 + 데일리 트레이딩 스캐너 공용
export const DEFAULT_UNIVERSE_US = ['NVDA','AAPL','MSFT','AMZN','GOOGL','META','TSLA','AVGO','AMD','NFLX',
    'PLTR','SMCI','MSTR','COIN','HOOD','RBLX','SHOP','SOFI','RKLB','MARA',
    // 레버리지 ETF (2x/3x 롱) — 상승장 증폭
    'TQQQ','QLD','SOXL','UPRO',
    // 역레버리지 ETF (숏) — 하락장 수익
    'SQQQ','SPXS','SOXS'];
export const DEFAULT_UNIVERSE_KR = ['005930.KS','035720.KS','035420.KS','000660.KS','005380.KS',
    '068270.KS','051910.KS','017670.KS','105560.KS','055550.KS'];

// ─────────────────────────────────────────────────────────────
// 조용 시간대 (Quiet Hours) — 사용자별 야간 음소거
// quiet JSON: { enabled: 1, start: 22, end: 7, tz_offset_min: 540 }
//   - start ~ end 가 같은 날 (e.g. 12~14) 이면 단순 비교
//   - end < start (e.g. 22~7) 면 다음날 새벽까지 음소거
// 반환: true 면 발송 스킵
// ─────────────────────────────────────────────────────────────
function isQuietNow(quietStr) {
    if (!quietStr) return false;
    let q;
    try { q = typeof quietStr === 'string' ? JSON.parse(quietStr) : quietStr; }
    catch { return false; }
    if (!q?.enabled) return false;
    const tzMin = Number.isFinite(q.tz_offset_min) ? q.tz_offset_min : 540; // 기본 KST
    const start = Number.isFinite(q.start) ? q.start : 22;
    const end   = Number.isFinite(q.end)   ? q.end   : 7;
    // 현재 UTC 시각 → 사용자 로컬 시각
    const localMs = Date.now() + tzMin * 60 * 1000;
    const localH = new Date(localMs).getUTCHours();
    if (start === end) return false;
    if (start < end) return localH >= start && localH < end;       // 같은 날
    return localH >= start || localH < end;                          // 자정 넘김
}

/**
 * 매 5분마다: 등록된 가격 알림을 체크해 조건 충족 시 푸시 발송
 */
export async function checkPriceAlerts(env) {
    try {
        // 1) 대기 중인 알림을 종목별로 그룹화
        const rs = await env.DB.prepare(
            'SELECT id, sub_token, endpoint, symbol, target_price, direction FROM price_alerts WHERE triggered=0 LIMIT 200'
        ).all();
        const alerts = rs.results || [];
        if (!alerts.length) return { checked: 0, fired: 0 };

        // 2) 종목별 시세를 한 번에 조회 (Yahoo quote multi)
        const symbols = [...new Set(alerts.map(a => a.symbol))];
        const chunks = [];
        for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
        const priceMap = new Map();
        for (const chunk of chunks) {
            try {
                const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
                const data = await yfRequest(env.CACHE, url);
                for (const r of (data?.quoteResponse?.result || [])) {
                    if (r.regularMarketPrice != null) priceMap.set(r.symbol, r.regularMarketPrice);
                }
            } catch (e) { console.warn('[cron] quote fail', e.message); }
        }

        // 3) 조건 매칭 알림 발송
        let fired = 0;
        for (const a of alerts) {
            const cur = priceMap.get(a.symbol);
            if (cur == null) continue;
            const hit = a.direction === 'above'
                ? cur >= a.target_price
                : cur <= a.target_price;
            if (!hit) continue;
            // 구독자 정보
            const sub = await env.DB.prepare(
                'SELECT endpoint, p256dh, auth FROM push_subscribers WHERE endpoint=?'
            ).bind(a.endpoint).first();
            if (!sub) continue;
            const arrow = a.direction === 'above' ? '⬆️' : '⬇️';
            const payload = JSON.stringify({
                title: `${arrow} ${a.symbol} ${cur.toFixed(2)} 도달`,
                body: `목표가 ${a.target_price.toFixed(2)} ${a.direction === 'above' ? '돌파' : '이탈'} — 현재가 ${cur.toFixed(2)}`,
                url: '/',
                tag: `price-${a.symbol}`,
            });
            try {
                const r = await sendPush(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload, env
                );
                if (r.ok || r.status === 201) {
                    await env.DB.prepare(
                        'UPDATE price_alerts SET triggered=1, triggered_at=? WHERE id=?'
                    ).bind(Date.now(), a.id).run();
                    fired++;
                } else if (r.status === 404 || r.status === 410) {
                    // 구독 만료 → subscriber 삭제 (gone)
                    await env.DB.prepare('DELETE FROM push_subscribers WHERE endpoint=?').bind(sub.endpoint).run();
                }
            } catch (e) { console.warn('[cron] push fail', a.symbol, e.message); }
        }
        return { checked: alerts.length, fired };
    } catch (e) {
        console.error('[cron] checkPriceAlerts', e.message);
        return { error: e.message };
    }
}

/**
 * 매일 KST 09시 (=UTC 00시): 사용자별 즐겨찾기 종목의 당일 실적 리마인더
 */
export async function earningsReminder(env) {
    try {
        // 모든 활성 구독자
        const rs = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth, favs FROM push_subscribers WHERE last_seen > ?'
        ).bind(Date.now() - 30 * 24 * 3600 * 1000).all(); // 30일 이내 활동
        let sent = 0;
        for (const sub of (rs.results || [])) {
            let favs = [];
            try { favs = JSON.parse(sub.favs || '[]'); } catch (_) {}
            if (!favs.length) continue;
            // 당일 실적 발표 종목 조회
            const todayEarnings = await _todayEarnings(env, favs);
            if (!todayEarnings.length) continue;
            const payload = JSON.stringify({
                title: `📅 오늘 실적 발표 ${todayEarnings.length}종목`,
                body: todayEarnings.slice(0, 5).join(', ') + (todayEarnings.length > 5 ? '...' : ''),
                url: '/',
                tag: 'earnings-today',
            });
            try {
                await sendPush(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload, env
                );
                sent++;
            } catch (e) { console.warn('[cron] earnings push', e.message); }
        }
        return { sent };
    } catch (e) {
        return { error: e.message };
    }
}

async function _todayEarnings(env, favs) {
    // Yahoo Finance 의 실적 캘린더 API 호출
    const todayStr = new Date().toISOString().split('T')[0];
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(favs.join(','))}`;
    try {
        const data = await yfRequest(env.CACHE, url);
        const list = (data?.quoteResponse?.result || [])
            .filter(r => {
                if (!r.earningsTimestamp) return false;
                const d = new Date(r.earningsTimestamp * 1000).toISOString().split('T')[0];
                return d === todayStr;
            })
            .map(r => r.symbol);
        return list;
    } catch (_) { return []; }
}

/**
 * 매 시간 :30분 — 시그널 정확도 추적
 * 미해결 signal_history 행을 찾아 N시간 후 가격을 채운다.
 *   - 1h 경과 → price_1h
 *   - 4h 경과 → price_4h
 *   - 24h 경과 → price_24h + max_gain_24h + max_loss_24h (5분봉 OHLC 기반)
 *   - 7d 경과 → price_7d + resolved=1
 *
 * Workers 30초 한계 보호 — 한 회당 최대 60건 처리.
 */
export async function resolveSignals(env) {
    try {
        const now = Date.now();
        const H = 3600 * 1000;
        const D = 24 * H;
        // 1) 미해결 시그널 (오래된 것부터 우선) — 한 회당 60건
        const rs = await env.DB.prepare(
            `SELECT id, symbol, direction, price, created_at,
                    price_1h, price_4h, price_24h, price_7d, max_gain_24h, loss_alerted
             FROM signal_history
             WHERE resolved=0 AND created_at < ?
             ORDER BY created_at ASC
             LIMIT 60`
        ).bind(now - H).all();
        const rows = rs.results || [];
        if (!rows.length) return { checked: 0, updated: 0 };

        // 2) 현재가 일괄 조회 (Yahoo quote multi)
        const symbols = [...new Set(rows.map(r => r.symbol))];
        const priceMap = new Map();
        for (let i = 0; i < symbols.length; i += 50) {
            const chunk = symbols.slice(i, i + 50);
            try {
                const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
                const data = await yfRequest(env.CACHE, url);
                for (const r of (data?.quoteResponse?.result || [])) {
                    if (r.regularMarketPrice != null) priceMap.set(r.symbol, r.regularMarketPrice);
                }
            } catch (e) { console.warn('[resolve] quote fail', e.message); }
        }

        // 3) 행마다 적절한 컬럼 채우기 + 즉시 큰 손실 감지 시 경고 푸시
        let updated = 0, lossAlerted = 0;
        for (const r of rows) {
            const age = now - r.created_at;
            const cur = priceMap.get(r.symbol);
            const sets = [];
            const args = [];

            // ── 즉시 손실 경고 (시그널 발생 후 24h 이내, 아직 미경고) ──
            if (!r.loss_alerted && age < 24 * H && cur != null && r.price > 0) {
                const lossPct = r.direction === 'buy'
                    ? ((cur - r.price) / r.price) * 100      // buy: 가격 하락 → 손실
                    : ((r.price - cur) / r.price) * 100;     // sell: 가격 상승 → 손실
                if (lossPct <= -5) {
                    // 해당 종목 즐겨찾기 보유한 구독자에게 손실 경고 발송
                    try {
                        const subs = await env.DB.prepare(
                            `SELECT endpoint, p256dh, auth, notif_prefs, quiet
                             FROM push_subscribers
                             WHERE favs LIKE ? AND last_seen > ?`
                        ).bind(`%${r.symbol}%`, now - 30 * 24 * H).all();
                        for (const s of (subs.results || [])) {
                            // 음소거 시간이면 스킵
                            if (isQuietNow(s.quiet)) continue;
                            // stop 알림 OFF 사용자 스킵
                            try {
                                const p = JSON.parse(s.notif_prefs || '{}');
                                if (!p.stop) continue;
                            } catch { /* default ON */ }
                            const payload = JSON.stringify({
                                title: `⚠️ ${r.symbol} 손실 ${lossPct.toFixed(1)}%`,
                                body: `${r.direction === 'buy' ? '매수' : '매도'} 시그널 이후 큰 손실 발생 — 현재 $${cur.toFixed(2)}`,
                                url: `/?s=${r.symbol}&signal=${r.id}`,
                                tag: `loss-${r.symbol}-${r.id}`,
                                signalId: r.id,
                            });
                            try {
                                await sendPush(
                                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                                    payload, env
                                );
                            } catch (e) { console.warn('[loss-alert] push', e.message); }
                        }
                        sets.push('loss_alerted=?'); args.push(1);
                        lossAlerted++;
                    } catch (e) { console.warn('[loss-alert]', e.message); }
                }
            }

            // 1h
            if (r.price_1h == null && age >= H && cur != null) {
                sets.push('price_1h=?'); args.push(cur);
            }
            // 4h
            if (r.price_4h == null && age >= 4 * H && cur != null) {
                sets.push('price_4h=?'); args.push(cur);
            }
            // 24h + max gain/loss (OHLC 필요)
            if (r.price_24h == null && age >= 24 * H && cur != null) {
                sets.push('price_24h=?'); args.push(cur);
                // 5분봉 1일 chart 로 max high / min low 산출 (시그널 시각 ~ +24h)
                try {
                    const raw = await fetchChartWithFallback(env, r.symbol, '5d', '5m', 'false');
                    const result = raw?.chart?.result?.[0];
                    const ts = result?.timestamp || [];
                    const q = result?.indicators?.quote?.[0];
                    if (q && ts.length) {
                        const sigSec = Math.floor(r.created_at / 1000);
                        const endSec = sigSec + 24 * 3600;
                        let hi = -Infinity, lo = Infinity;
                        for (let i = 0; i < ts.length; i++) {
                            if (ts[i] < sigSec || ts[i] > endSec) continue;
                            if (q.high?.[i] != null && q.high[i] > hi) hi = q.high[i];
                            if (q.low?.[i]  != null && q.low[i]  < lo) lo = q.low[i];
                        }
                        if (hi > -Infinity && lo < Infinity && r.price > 0) {
                            const gain = ((hi - r.price) / r.price) * 100;
                            const loss = ((lo - r.price) / r.price) * 100; // 음수
                            sets.push('max_gain_24h=?'); args.push(+gain.toFixed(2));
                            sets.push('max_loss_24h=?'); args.push(+loss.toFixed(2));
                        }
                    }
                } catch (e) { console.warn('[resolve] ohlc fail', r.symbol, e.message); }
            }
            // 7d
            if (r.price_7d == null && age >= 7 * D && cur != null) {
                sets.push('price_7d=?'); args.push(cur);
                sets.push('resolved=?'); args.push(1);
                sets.push('resolved_at=?'); args.push(now);
            }
            if (!sets.length) continue;
            args.push(r.id);
            await env.DB.prepare(`UPDATE signal_history SET ${sets.join(',')} WHERE id=?`)
                .bind(...args).run();
            updated++;
        }
        return { checked: rows.length, updated, lossAlerted };
    } catch (e) {
        console.error('[cron] resolveSignals', e.message);
        return { error: e.message };
    }
}

/**
 * 디스커버리 유니버스 — 당일 데이트레이딩 활발 종목 (Yahoo 스크리너).
 * most_actives(거래량 상위) + day_gainers(상승률 상위) → 단타 적합 종목.
 * 가격/유동성 필터로 페니주·저유동성 제외. US 한정(1차).
 */
export async function _fetchDiscoverySymbols(env, marketHint) {
    if (marketHint === 'KR') return []; // KR 스크리너 추후
    const base = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
        + '?formatted=false&lang=en-US&region=US&count=30&scrIds=';
    try {
        const [act, gain] = await Promise.allSettled([
            yfRequest(env.CACHE, base + 'most_actives'),
            yfRequest(env.CACHE, base + 'day_gainers'),
        ]);
        const pick = r => (r.status === 'fulfilled' ? (r.value?.finance?.result?.[0]?.quotes || []) : []);
        const rows = [...pick(act), ...pick(gain)];
        const syms = rows
            .filter(q => q && q.regularMarketPrice >= 2 && q.regularMarketPrice <= 600
                      && (q.averageDailyVolume3Month || 0) >= 500000
                      && /^[A-Z]{1,5}$/.test(q.symbol || ''))
            .map(q => q.symbol);
        return [...new Set(syms)].slice(0, 30);
    } catch (e) { console.warn('[discovery] universe fail', e.message); return []; }
}

/**
 * 매 5분마다 (또는 *5분봉* cron trigger): 활성 구독자의 즐겨찾기 종목 +
 * 당일 발굴 종목을 5분봉으로 분석 → 즐겨찾기는 임계값↑ 푸시, 발굴은 S급만 푸시.
 *
 * 중복 방지: signal_history 6시간 cooldown (같은 종목+방향).
 * 최대 처리량 보호: 구독자 100명 / 종목 50개 / 5분 = Workers 한계 내(waitUntil).
 */
export async function analyzeSignals(env, marketHint = 'ALL') {
    try {
        // 1) 30일 이내 활동한 구독자 + 즐겨찾기 + 알림 선호 + 시장 필터 모음
        const rs = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth, favs, notif_prefs, market_filter, quiet FROM push_subscribers WHERE last_seen > ? LIMIT 100'
        ).bind(Date.now() - 30 * 24 * 3600 * 1000).all();
        const subs = rs.results || [];
        if (!subs.length) return { subscribers: 0, fired: 0 };

        // 2) 즐겨찾기 종목 dedupe + 매수 알림 켠 구독자만 + 시장 필터 일치만
        // symbolToSubs: symbol → [{endpoint, p256dh, auth, prefs, marketFilter, quiet}]
        const symbolToSubs = new Map();
        for (const sub of subs) {
            let favs = [], prefs = { buy:1, tp:1, stop:1, pos:1 };
            try { favs = JSON.parse(sub.favs || '[]'); } catch (_) {}
            try { prefs = JSON.parse(sub.notif_prefs || '{"buy":1,"tp":1,"stop":1,"pos":1}'); } catch (_) {}
            const subMarket = sub.market_filter || 'ALL';
            // 시장 필터: cron 호출 시 marketHint 와 사용자의 market_filter 둘 다 매치되어야 함
            if (marketHint !== 'ALL' && subMarket !== 'ALL' && subMarket !== marketHint) continue;
            // 조용 시간대 — 현재 음소거 중이면 이 사용자에게 푸시 안 보냄
            if (isQuietNow(sub.quiet)) continue;
            for (const sym of favs) {
                if (!sym) continue;
                const arr = symbolToSubs.get(sym) || [];
                arr.push({
                    endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth,
                    prefs, marketFilter: subMarket,
                });
                symbolToSubs.set(sym, arr);
            }
        }
        // 즐겨찾기 + 기본 풀 합치기 (즐겨찾기 우선)
        // 기본 풀 종목은 시그널 발견 시 signal_history 에 INSERT 만 (푸시는 즐겨찾기 한정)
        // → 백테스트 / 시그널 통계 페이지에 누적 데이터 확보 + 푸시 스팸 방지
        const DEFAULT_UNIVERSE = marketHint === 'KR' ? DEFAULT_UNIVERSE_KR : DEFAULT_UNIVERSE_US;
        const favSymbols = [...symbolToSubs.keys()];
        const favSet = new Set(favSymbols);
        // 디스커버리 — 당일 활발 종목 동적 발굴 (US)
        const dynamic = await _fetchDiscoverySymbols(env, marketHint);
        const allSymbols = [...new Set([...favSymbols, ...DEFAULT_UNIVERSE, ...dynamic])].slice(0, 50);
        if (!allSymbols.length) return { subscribers: subs.length, marketHint, fired: 0 };

        // 디스커버리 푸시 대상 구독자 (discovery 토글 ON + 조용시간 아님 + 시장필터)
        const discoverySubs = subs.filter(s => {
            let p = {};
            try { p = JSON.parse(s.notif_prefs || '{}'); } catch (_) {}
            if (!(p.discovery ?? 1)) return false;
            if (isQuietNow(s.quiet)) return false;
            const subMarket = s.market_filter || 'ALL';
            if (marketHint !== 'ALL' && subMarket !== 'ALL' && subMarket !== marketHint) return false;
            return true;
        }).map(s => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, prefs: (() => { try { return JSON.parse(s.notif_prefs||'{}'); } catch(_) { return {}; } })() }));

        // 동적 알고리즘 설정 + 블랙리스트 로드 (자동 보정 결과 반영)
        const [thresholds, blacklist] = await Promise.all([
            loadAlgorithmConfig(env),
            loadBlacklist(env),
        ]);
        // 시장 레짐 — 위험 장세엔 약한 매수 디스커버리 푸시 억제 (US 한정)
        const regime = marketHint === 'KR' ? { regime: 'neutral' } : await getMarketRegime(env);

        // 3) 각 종목 5분봉 분석 + 시그널 발견 시 푸시 큐잉
        let fired = 0, analyzed = 0, skippedBlacklist = 0;
        for (const symbol of allSymbols) {
            // 블랙리스트 종목 — 시그널 분석 자체 스킵
            if (blacklist.has(symbol)) { skippedBlacklist++; continue; }
            try {
                // Yahoo crumb 실패 시 자동으로 Polygon fallback
                const raw = await fetchChartWithFallback(env, symbol, '1d', '5m', 'false');
                const result = raw?.chart?.result?.[0];
                if (!result) continue;
                const q = result.indicators?.quote?.[0];
                if (!q?.close?.length) continue;
                const ts = result.timestamp || [];
                analyzed++;

                const sig = detectSignal(q, thresholds);
                if (!sig) continue;
                // min_score_for_push 임계값 통과 안 하면 스킵 (calibration 설정)
                // 푸시는 즐겨찾기 종목 한정 + 사용자 prefs 추가 체크
                if (sig.score < (thresholds.min_score_for_push ?? 5.5)) continue;

                const candleTs = ts[ts.length - 1] || Math.floor(Date.now() / 1000);

                // 중복 체크 — 6시간 cooldown (같은 종목+방향 시그널 6h 내 1회만)
                // 이전: 1분 → 5분봉 노이즈가 그대로 알림으로 흘러감
                // 변경: 21600초(6h) → 의미 있는 신호만 발송
                const COOLDOWN_SEC = 6 * 3600;
                const existing = await env.DB.prepare(
                    'SELECT id, pushed_at FROM signal_history WHERE symbol=? AND direction=? AND created_at >= ? ORDER BY created_at DESC LIMIT 1'
                ).bind(symbol, sig.dir, Date.now() - COOLDOWN_SEC * 1000).first();
                if (existing) continue; // 6시간 이내 같은 시그널 → 스킵

                const isFav = favSet.has(symbol);
                // signal_history 기록 (source: favs | discovery)
                const now = Date.now();
                const insRes = await env.DB.prepare(
                    'INSERT INTO signal_history (symbol, market, direction, grade, score, win_rate, price, headline, created_at, pushed_at, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
                ).bind(
                    symbol, marketHint === 'KR' ? 'KR' : 'US', sig.dir, sig.grade, sig.score, sig.winRate,
                    sig.price, sig.factors.slice(0, 3).join(' · '),
                    now, now, isFav ? 'favs' : 'discovery'
                ).run();
                const signalId = insRes.meta?.last_row_id || null;

                const arrow = sig.dir === 'buy' ? '📈' : '📉';
                const dirKo = sig.dir === 'buy' ? '매수' : '매도';
                const subList = symbolToSubs.get(symbol) || [];

                if (isFav && subList.length) {
                    // ── 즐겨찾기 푸시 (기존 — 점수≥min_score_for_push, prefs.buy/stop 존중) ──
                    const payload = JSON.stringify({
                        title: `${arrow} ${symbol} ${dirKo} 시그널 [${sig.grade}급]`,
                        body: `$${sig.price.toFixed(2)} · 예상 승률 ${sig.winRate}% · ${sig.factors.slice(0, 2).join(' · ')}`,
                        url: `/?s=${symbol}&signal=${signalId || ''}`,
                        tag: `signal-${symbol}-${sig.dir}`, signalId,
                    });
                    for (const sub of subList) {
                        if (sig.dir === 'buy'  && !sub.prefs?.buy)  continue;
                        if (sig.dir === 'sell' && !sub.prefs?.stop) continue;
                        try {
                            const r = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, env);
                            if (r.ok || r.status === 201) fired++;
                            else if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subscribers WHERE endpoint=?').bind(sub.endpoint).run();
                        } catch (e) { console.warn('[signal-push] fail', symbol, e.message); }
                    }
                } else if (!isFav) {
                    // ── 디스커버리 푸시 — S/A급, discovery 토글 켠 전체 구독자 ──
                    if (sig.grade !== 'S' && sig.grade !== 'A') continue;
                    // 위험 장세엔 약한 매수(A급) 발굴 알림 억제 — S급·매도는 유지
                    if (regime.regime === 'risk_off' && sig.dir === 'buy' && sig.grade !== 'S') continue;
                    const payload = JSON.stringify({
                        title: `🔍 발굴 ${symbol} ${dirKo} 진입 [${sig.grade}급]`,
                        body: `$${sig.price.toFixed(2)} · 5분봉 단타 · 승률 ${sig.winRate}% · ${sig.factors.slice(0, 2).join(' · ')}`,
                        url: `/?s=${symbol}&signal=${signalId || ''}`,
                        tag: `disc-${symbol}-${sig.dir}`, signalId,
                    });
                    for (const sub of discoverySubs) {
                        // 매수=buy 토글, 매도=stop 토글 존중 (discovery 토글은 이미 위에서 필터)
                        if (sig.dir === 'buy'  && !(sub.prefs?.buy  ?? 1)) continue;
                        if (sig.dir === 'sell' && !(sub.prefs?.stop ?? 1)) continue;
                        try {
                            const r = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, env);
                            if (r.ok || r.status === 201) fired++;
                            else if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subscribers WHERE endpoint=?').bind(sub.endpoint).run();
                        } catch (e) { console.warn('[disc-push] fail', symbol, e.message); }
                    }
                }
            } catch (e) { console.warn('[analyze] fail', symbol, e.message); }
        }
        try { await paperManageAll(env); } catch (_) {}

        return { subscribers: subs.length, symbols: allSymbols.length, favSymbols: favSymbols.length, dynamic: dynamic.length, analyzed, fired, skippedBlacklist };
    } catch (e) {
        console.error('[cron] analyzeSignals', e.message);
        return { error: e.message };
    }
}

/**
 * 매일 UTC 00:05 — 일별 헬스 스냅샷 + cron 에러 자동 로깅
 * health_snapshots 에 어제 날짜 메트릭 누적 기록
 */
export async function snapshotHealth(env) {
    try {
        const D = 24 * 3600 * 1000;
        const now = Date.now();
        const since24h = now - D;
        // 어제 날짜 (YYYY-MM-DD) — UTC 기준
        const yesterday = new Date(now - D).toISOString().split('T')[0];

        const subStats = await env.DB.prepare(
            `SELECT COUNT(*) AS total,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS active
             FROM push_subscribers`
        ).bind(since24h).first();

        const sigCount = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM signal_history WHERE created_at >= ?'
        ).bind(since24h).first();

        const pushCount = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM signal_history WHERE pushed_at >= ?'
        ).bind(since24h).first();

        const errCount = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM errors WHERE created_at >= ?'
        ).bind(since24h).first();

        const fbCount = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM signal_feedback WHERE created_at >= ?'
        ).bind(since24h).first();

        await env.DB.prepare(
            `INSERT INTO health_snapshots (snapshot_date, subscribers, active_24h, signals_24h, pushes_24h, errors_24h, feedbacks_24h, created_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(snapshot_date) DO UPDATE SET
                subscribers=excluded.subscribers,
                active_24h=excluded.active_24h,
                signals_24h=excluded.signals_24h,
                pushes_24h=excluded.pushes_24h,
                errors_24h=excluded.errors_24h,
                feedbacks_24h=excluded.feedbacks_24h`
        ).bind(
            yesterday,
            subStats?.total || 0,
            subStats?.active || 0,
            sigCount?.c || 0,
            pushCount?.c || 0,
            errCount?.c || 0,
            fbCount?.c || 0,
            now
        ).run();

        return { date: yesterday, subscribers: subStats?.total || 0, signals: sigCount?.c || 0, errors: errCount?.c || 0 };
    } catch (e) {
        await logError(env, { source: 'cron', message: 'snapshotHealth: ' + e.message, stack: e.stack });
        return { error: e.message };
    }
}
