// 성장주 발굴 레이어 — 종목/섹터 단위 뉴스·촉매 감성 모멘텀
// 뉴스는 기존 getNewsSentiment() 재사용(30분 캐시, 추가 부담 적음).
// 촉매 점수는 별도 API를 다시 호출하지 않고 기존 catalyst_signals 테이블을 당일 날짜+티커로
// JOIN만 해서 재사용 — captureCatalystSignals()가 이미 자체 스케줄로 채워둔 데이터.
import { getNewsSentiment } from './news-sentiment.js';

export async function getCompanyNewsMomentum(env, symbol) {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const dayStart = new Date(snapshotDate + 'T00:00:00Z').getTime();

    const news = await getNewsSentiment(env, symbol).catch(() => ({ score: 0, headline: '' }));

    const catalystRow = await env.DB.prepare(
        'SELECT score FROM catalyst_signals WHERE ticker=? AND created_at>=? ORDER BY created_at DESC LIMIT 1'
    ).bind(symbol, dayStart).first().catch(() => null);
    const catalystScore = catalystRow?.score ?? null;

    await env.DB.prepare(`
        INSERT INTO news_momentum (scope,key,snapshot_date,avg_score,headline_count,catalyst_score,created_at)
        VALUES ('company',?,?,?,?,?,?)
        ON CONFLICT(scope,key,snapshot_date) DO UPDATE SET avg_score=excluded.avg_score, catalyst_score=excluded.catalyst_score
    `).bind(symbol, snapshotDate, news.score || 0, news.headline ? 1 : 0, catalystScore, Date.now()).run();

    return { newsScore: news.score || 0, headline: news.headline || '', catalystScore };
}
