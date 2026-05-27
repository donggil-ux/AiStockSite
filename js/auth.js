// js/auth.js — Clerk 인증 통합
// 책임:
//   1. Clerk SDK 로드 + 초기화 (Publishable Key 사용)
//   2. window.getAuthToken() 구현 → fetch 인터셉터가 Bearer 헤더 자동 주입
//   3. 로그인/로그아웃 모달 — 설정 모달 또는 별도 버튼
//   4. 로그인 직후 — 백엔드 /api/push/link 호출로 다기기 데이터 병합
//
// 의존: state.js (window.getAuthToken 스텁), api.js (즐겨찾기 sync)

(function _initAuth() {
    // Publishable Key — index.html <meta name="clerk-publishable-key"> 에서 읽음
    const meta = document.querySelector('meta[name="clerk-publishable-key"]');
    const PUBLISHABLE_KEY = meta?.content || '';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    // 로컬 또는 키 미설정 시 비활성 (앱은 익명 모드로 정상 작동)
    if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.startsWith('pk_REPLACE')) {
        console.log('[auth] Clerk 비활성 — 익명 모드');
        window.__authReady = Promise.resolve(false);
        return;
    }

    // Clerk Frontend API 도메인 추출
    function clerkDomain() {
        const parts = PUBLISHABLE_KEY.split('_');
        if (parts.length < 3) return null;
        const b64 = parts.slice(2).join('_').replace(/\$$/, '').replace(/-/g, '+').replace(/_/g, '/');
        try {
            const decoded = atob(b64).replace(/\$$/, '').trim();
            return decoded || null;
        } catch (_) { return null; }
    }

    function loadClerkScript() {
        return new Promise((resolve, reject) => {
            if (window.Clerk) return resolve(window.Clerk);
            const domain = clerkDomain();
            if (!domain) return reject(new Error('clerk domain parse failed'));
            const s = document.createElement('script');
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.setAttribute('data-clerk-publishable-key', PUBLISHABLE_KEY);
            // Clerk JS SDK v5 — Frontend API 도메인 기반 로드
            s.src = `https://${domain}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
            s.onload = () => resolve(window.Clerk);
            s.onerror = (e) => reject(e);
            document.head.appendChild(s);
        });
    }

    async function init() {
        try {
            await loadClerkScript();
            const Clerk = window.Clerk;
            await Clerk.load({
                // 로그인 후 리다이렉트 없이 같은 페이지 유지
                signInUrl: '#',
                signUpUrl: '#',
            });

            // ── 세션 토큰 게터 (fetch 인터셉터가 호출) ──
            window.getAuthToken = async () => {
                try {
                    const s = Clerk.session;
                    if (!s) return null;
                    return await s.getToken();
                } catch (_) { return null; }
            };

            // 로그인/세션 변경 감지 — UI 갱신 + 데이터 sync
            Clerk.addListener(({ user, session }) => {
                _renderAuthState(user);
                if (session && !window._authLastUserId) {
                    window._authLastUserId = user?.id;
                    _afterSignIn(user);
                } else if (!session && window._authLastUserId) {
                    window._authLastUserId = null;
                    _afterSignOut();
                }
            });

            _renderAuthState(Clerk.user);
            if (Clerk.session && Clerk.user) {
                window._authLastUserId = Clerk.user.id;
                // 첫 로드 시에도 link 한 번 호출 (다기기 데이터 병합)
                _linkAccount();
            }
            console.log('[auth] Clerk 활성 — user=', Clerk.user?.id || 'none');
            return true;
        } catch (e) {
            console.warn('[auth] Clerk 초기화 실패', e);
            return false;
        }
    }

    window.__authReady = init();

    // ──────────────────────────────────────────────────────────
    // UI 헬퍼
    // ──────────────────────────────────────────────────────────
    // 외부 트리거 — 모달 열릴 때 등 (state.js 의 window.getAuthToken 외에 노출)
    window._authRefreshUI = function () { try { _renderAuthState(window.Clerk?.user); } catch (_) {} };
    function _renderAuthState(user) {
        // 설정 모달의 로그인 카드 갱신
        const card = document.getElementById('authStatusCard');
        if (!card) return;
        if (user) {
            const name = user.firstName || user.username || user.emailAddresses?.[0]?.emailAddress || '사용자';
            const email = user.emailAddresses?.[0]?.emailAddress || '';
            const avatar = user.imageUrl ? `<img src="${user.imageUrl}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;">` :
                                            `<div class="auth-avatar-fallback">${(name[0] || '?').toUpperCase()}</div>`;
            card.innerHTML = `
                <div class="auth-user">
                    ${avatar}
                    <div class="auth-user-info">
                        <div class="auth-user-name">${name}</div>
                        <div class="auth-user-email">${email}</div>
                        <div class="auth-user-status">✓ 로그인됨 · 다기기 동기화 활성</div>
                    </div>
                </div>
                <button class="auth-btn auth-btn-secondary" onclick="window.signOut()">로그아웃</button>
            `;
        } else {
            card.innerHTML = `
                <div class="auth-empty">
                    <div class="auth-empty-icon">👤</div>
                    <div class="auth-empty-title">로그인하면 다기기 동기화가 활성됩니다</div>
                    <div class="auth-empty-desc">즐겨찾기·알림 설정이 모든 기기에서 자동 동기화됩니다.</div>
                </div>
                <button class="auth-btn auth-btn-primary" onclick="window.signIn()">Google · Apple 로 로그인</button>
            `;
        }
    }

    // 전역 노출 — UI 버튼에서 호출
    window.signIn = function () {
        const Clerk = window.Clerk;
        if (!Clerk) return alert('Clerk 미초기화');
        Clerk.openSignIn({
            // 로그인 후 모달 닫고 현재 페이지 유지
            afterSignInUrl: location.href,
            afterSignUpUrl: location.href,
        });
    };
    window.signOut = async function () {
        try {
            await window.Clerk?.signOut();
            try { window.snack?.('로그아웃되었습니다', 'info'); } catch (_) {}
        } catch (e) { console.warn('[auth] signOut', e); }
    };

    // ──────────────────────────────────────────────────────────
    // 로그인 직후 동기화
    // ──────────────────────────────────────────────────────────
    async function _linkAccount() {
        try {
            // 백엔드에 sub_token + endpoint 전송 → user_id 와 연결 + 다기기 favs 병합
            const subToken = localStorage.getItem('stockai_push_token');
            const endpoint = localStorage.getItem('stockai_push_endpoint');
            if (!subToken || !endpoint) {
                console.log('[auth] link skip — 푸시 구독 없음');
                return;
            }
            const base = window.API_WORKERS_BASE || '';
            const res = await fetch(base + '/api/push/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subToken, endpoint }),
            });
            if (!res.ok) return;
            const data = await res.json();
            // 다기기 병합된 즐겨찾기 적용
            if (Array.isArray(data.favs) && data.favs.length) {
                try {
                    const local = JSON.parse(localStorage.getItem('stockai_favorites') || '[]');
                    const merged = [...new Set([...data.favs, ...local])].slice(0, 30);
                    localStorage.setItem('stockai_favorites', JSON.stringify(merged));
                    window.favorites = merged;
                    try { window.renderFavorites?.(); } catch (_) {}
                    try { window.snack?.(`다기기 즐겨찾기 ${data.favs.length}개 동기화됨`, 'success'); } catch (_) {}
                } catch (_) {}
            }
            // notif_prefs / market_filter 적용
            if (data.prefs) {
                try { localStorage.setItem('stockai_notif_prefs', JSON.stringify(data.prefs)); } catch (_) {}
            }
            if (data.marketFilter) {
                try { localStorage.setItem('stockai_market_filter', data.marketFilter); } catch (_) {}
            }
        } catch (e) {
            console.warn('[auth] link 실패', e);
        }
    }

    function _afterSignIn(user) {
        try { window.snack?.(`${user?.firstName || '환영합니다'} — 다기기 동기화가 활성됐어요`, 'success'); } catch (_) {}
        _linkAccount();
    }
    function _afterSignOut() {
        // 로그아웃 — localStorage 의 동기화 데이터는 유지 (기기 단독 모드)
        // 차후 fetch 는 Authorization 헤더 없이 sub_token 모드로 동작
        try { window.snack?.('로그아웃되었습니다 — 기기 단독 모드', 'info'); } catch (_) {}
    }
})();
