#!/usr/bin/env node
/**
 * 라우트 단위 smoke test — 배포 전 검증
 *
 * 실행: node scripts/smoke-test.js  (또는 npm run smoke)
 *
 * 목적:
 *   1. 서버가 listen 까지 도달하는지 확인 (TDZ 외 라우트 등록 단계 이슈)
 *   2. 외부 API 의존이 없는 핵심 라우트가 정상 응답하는지
 *   3. 입력 검증 라우트가 400/404/etc 적절히 반환하는지
 *
 * 외부 API(Yahoo, Gemini 등)는 호출하지 않음 → 네트워크 불안정과 무관하게 통과/실패 판정.
 */

const app = require('../server.js');

// 테스트 케이스: 외부 API 호출 없이 응답이 결정되는 라우트만 포함
const tests = [
    { name: 'health',                method: 'GET',  path: '/health',                            expectCodes: [200] },
    { name: 'invalid quote symbol',  method: 'GET',  path: '/api/quote?symbols=!!INVALID',       expectCodes: [400] },
    { name: 'invalid summary symbol',method: 'GET',  path: '/api/summary/!!INVALID',             expectCodes: [400] },
    { name: 'invalid options symbol',method: 'GET',  path: '/api/options/!!INVALID',             expectCodes: [400] },
    { name: 'invalid screener',      method: 'GET',  path: '/api/screener/notavalidfilter',      expectCodes: [400] },
    { name: 'naver-board: US sym',   method: 'GET',  path: '/api/naver-board/AAPL',              expectCodes: [400] },
    { name: 'paxnet-board: US sym',  method: 'GET',  path: '/api/paxnet-board/AAPL',             expectCodes: [400] },
    { name: 'apewisdom invalid',     method: 'GET',  path: '/api/apewisdom/!!INVALID',           expectCodes: [400] },
    { name: 'cron without auth',     method: 'GET',  path: '/api/cron/check-alerts',             expectCodes: [401, 403, 503] },
];

const PORT = 0; // OS 가 빈 포트 자동 할당

const server = app.listen(PORT, async () => {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    let pass = 0, fail = 0;
    const failures = [];

    for (const t of tests) {
        try {
            const res = await fetch(`${base}${t.path}`, { method: t.method });
            const ok = t.expectCodes.includes(res.status);
            if (ok) {
                pass++;
                console.log(`✅ ${t.name.padEnd(28)} → ${res.status}`);
            } else {
                fail++;
                const body = await res.text().catch(() => '<read error>');
                failures.push({ ...t, actual: res.status, body: body.slice(0, 200) });
                console.log(`❌ ${t.name.padEnd(28)} → ${res.status} (expected ${t.expectCodes.join('/')})`);
            }
        } catch (e) {
            fail++;
            failures.push({ ...t, error: e.message });
            console.log(`💥 ${t.name.padEnd(28)} → ${e.message}`);
        }
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) {
        console.log('\n실패 상세:');
        failures.forEach(f => console.log('  ', JSON.stringify(f, null, 2)));
    }
    server.close();
    process.exit(fail > 0 ? 1 : 0);
});

server.on('error', (err) => {
    console.error('💥 서버 시작 실패:', err.message);
    process.exit(1);
});

// 안전 타임아웃 — 30초 내 완료 못 하면 강제 종료
setTimeout(() => {
    console.error('⏱  smoke test 타임아웃 (30s)');
    server.close();
    process.exit(1);
}, 30000).unref();
