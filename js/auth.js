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

    // Clerk 인증 핸드셰이크 파라미터를 현재 URL 에서 제거 (그 외 파라미터는 보존)
    function _stripClerkUrlParams() {
        try {
            const u = new URL(location.href);
            let changed = false;
            [...u.searchParams.keys()].forEach(k => {
                if (k.startsWith('__clerk') || k.startsWith('__dev') || k === '__session') {
                    u.searchParams.delete(k); changed = true;
                }
            });
            if (changed) {
                const qs = u.searchParams.toString();
                history.replaceState(history.state, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
            }
        } catch (_) {}
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
            // Clerk 가 핸드셰이크 토큰을 이미 소비(→localStorage)했으므로 URL 에서 제거.
            // 안 그러면 dev 인스턴스에서 __clerk_db_jwt(로그인 토큰)가 주소창·종목상세 URL에 노출됨.
            _stripClerkUrlParams();
            window._clerkReady = true;
            console.log('[auth] Clerk 활성 — user=', Clerk.user?.id || 'none');
            return true;
        } catch (e) {
            window._clerkReady = true; // 실패해도 대기 해제 (무한 대기 방지)
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

    // ──────────────────────────────────────────────────────────
    // 로그인 페이지 (오늘의집 스타일 풀스크린)
    // ──────────────────────────────────────────────────────────
    window.goLogin = function () {
        const ls = document.getElementById('loginScreen');
        if (!ls) return;
        // 이미 로그인된 사용자는 페이지 안 보임
        if (window.Clerk?.user) {
            try { window.snack?.('이미 로그인되어 있습니다', 'info'); } catch(_) {}
            return;
        }
        ls.style.display = '';
        document.body.style.overflow = 'hidden';
    };
    window.closeLogin = function () {
        const ls = document.getElementById('loginScreen');
        if (ls) ls.style.display = 'none';
        document.body.style.overflow = '';
    };
    // 커스텀 이메일/비밀번호 로그인 — Clerk signIn API (모달 없이 직접)
    window._loginSubmit = async function () {
        const Clerk = window.Clerk;
        const errEl = document.getElementById('loginError');
        const setErr = m => { if (errEl) errEl.textContent = m || ''; };
        setErr('');
        if (!Clerk) { setErr('현재 환경에서는 로그인을 사용할 수 없습니다.'); return; }
        const email = (document.getElementById('loginEmailInput')?.value || '').trim();
        const pwd = document.getElementById('loginPwdInput')?.value || '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('올바른 이메일을 입력해주세요.');
        if (!pwd) return setErr('비밀번호를 입력해주세요.');
        const btn = document.getElementById('loginSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = '로그인 중…'; }
        try {
            const res = await Clerk.client.signIn.create({ identifier: email, password: pwd });
            if (res.status === 'complete') {
                await Clerk.setActive({ session: res.createdSessionId });
                window.closeLogin();
                try { window.snack?.('로그인되었습니다', 'success'); } catch (_) {}
            } else {
                setErr('로그인이 완료되지 않았습니다. 다시 시도해주세요.');
            }
        } catch (e) {
            // Clerk 에러: 비번 틀림/계정없음 등
            const msg = (e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || '');
            setErr(/identifier|not found|couldn't find/i.test(msg) ? '가입되지 않은 이메일입니다.'
                : /password|incorrect|invalid/i.test(msg) ? '이메일 또는 비밀번호가 올바르지 않습니다.'
                : (msg || '로그인에 실패했습니다.'));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
        }
    };

    // 로그인 페이지 내부 트리거 — Clerk 모달로 위임 (구버전 폴백)
    window._loginOpenClerk = function () {
        const Clerk = window.Clerk;
        if (!Clerk) return alert('Clerk 미초기화');
        Clerk.openSignIn({
            afterSignInUrl: location.href,
            afterSignUpUrl: location.href,
        });
    };
    // 회원가입 모달 (구버전 — Clerk 기본 모달, 폴백용)
    window._loginOpenClerkSignUp = function () {
        const Clerk = window.Clerk;
        if (!Clerk) return alert('Clerk 미초기화');
        Clerk.openSignUp({
            afterSignInUrl: location.href,
            afterSignUpUrl: location.href,
        });
    };

    // ──────────────────────────────────────────────────────────
    // 커스텀 회원가입 화면 (이메일/비밀번호 직접 가입 — Clerk signUp API)
    // ──────────────────────────────────────────────────────────
    function _clerkErr(e) {
        try { return e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || '오류가 발생했습니다'; }
        catch (_) { return '오류가 발생했습니다'; }
    }
    function _suSetError(id, msg) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg || '';
    }
    function _suEmail() {
        const local = (document.getElementById('suEmailLocal')?.value || '').trim();
        const sel = document.getElementById('suEmailDomain');
        const custom = (document.getElementById('suEmailDomainCustom')?.value || '').trim();
        const domain = (sel && sel.value) ? sel.value : custom;
        if (!local || !domain) return '';
        return `${local}@${domain}`;
    }
    let _suTermsBound = false;
    function _suBindTerms() {
        if (_suTermsBound) return;
        _suTermsBound = true;
        const all = document.getElementById('suAgreeAll');
        const terms = [...document.querySelectorAll('.su-term')];
        terms.forEach(t => t.addEventListener('change', () => {
            if (all) all.checked = terms.every(x => x.checked);
        }));
    }

    window.goSignup = function () {
        const ss = document.getElementById('signupScreen');
        if (!ss) return;
        if (window.Clerk?.user) { try { window.snack?.('이미 로그인되어 있습니다', 'info'); } catch (_) {} return; }
        // 폼 단계로 초기화
        document.getElementById('signupFormStep').style.display = '';
        document.getElementById('signupVerifyStep').style.display = 'none';
        _suSetError('suError', ''); _suSetError('suVerifyError', '');
        _suBindTerms();
        ss.style.display = '';
        document.body.style.overflow = 'hidden';
    };
    window.closeSignup = function () {
        const ss = document.getElementById('signupScreen');
        if (ss) ss.style.display = 'none';
        document.body.style.overflow = '';
    };
    window._suDomainChange = function (sel) {
        const custom = document.getElementById('suEmailDomainCustom');
        if (!custom) return;
        // '직접입력'(value='') 선택 시 커스텀 도메인 입력 노출
        custom.style.display = sel.value === '' ? 'block' : 'none';
    };
    window._suToggleAll = function (cb) {
        document.querySelectorAll('.su-term').forEach(t => { t.checked = cb.checked; });
    };

    window._suSubmit = async function () {
        const Clerk = window.Clerk;
        const btn = document.getElementById('suSubmitBtn');
        _suSetError('suError', '');
        if (!Clerk) { _suSetError('suError', '현재 환경에서는 회원가입을 사용할 수 없습니다.'); return; }

        const email = _suEmail();
        const pwd = document.getElementById('suPwd')?.value || '';
        const pwd2 = document.getElementById('suPwd2')?.value || '';
        const nick = (document.getElementById('suNick')?.value || '').trim();
        const ageOk = document.getElementById('suAge')?.checked;
        const tosOk = document.getElementById('suTos')?.checked;
        const mkt = document.getElementById('suMkt')?.checked;

        // ── 검증 ──
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return _suSetError('suError', '올바른 이메일을 입력해주세요.');
        if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pwd)) return _suSetError('suError', '비밀번호는 영문·숫자 포함 8자 이상이어야 합니다.');
        if (pwd !== pwd2) return _suSetError('suError', '비밀번호가 일치하지 않습니다.');
        if (nick.length < 2 || nick.length > 20) return _suSetError('suError', '닉네임은 2~20자로 입력해주세요.');
        if (!ageOk || !tosOk) return _suSetError('suError', '필수 약관(만 14세 이상, 이용약관)에 동의해주세요.');

        if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
        try {
            await Clerk.client.signUp.create({
                emailAddress: email,
                password: pwd,
                unsafeMetadata: { nickname: nick, marketing: !!mkt },
            });
            await Clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            // 인증 단계로 전환
            const ve = document.getElementById('suVerifyEmail');
            if (ve) ve.textContent = email;
            document.getElementById('signupFormStep').style.display = 'none';
            document.getElementById('signupVerifyStep').style.display = '';
            _suSetError('suVerifyError', '');
            setTimeout(() => document.getElementById('suCode')?.focus(), 100);
        } catch (e) {
            _suSetError('suError', _clerkErr(e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '회원가입하기'; }
        }
    };

    window._suVerify = async function () {
        const Clerk = window.Clerk;
        const btn = document.getElementById('suVerifyBtn');
        _suSetError('suVerifyError', '');
        if (!Clerk) return;
        const code = (document.getElementById('suCode')?.value || '').trim();
        if (!/^\d{6}$/.test(code)) return _suSetError('suVerifyError', '6자리 인증 코드를 입력해주세요.');
        if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
        try {
            const res = await Clerk.client.signUp.attemptEmailAddressVerification({ code });
            if (res.status === 'complete') {
                await Clerk.setActive({ session: res.createdSessionId });
                window.closeSignup();
                try { window.snack?.('회원가입이 완료되었습니다 — 환영합니다!', 'success'); } catch (_) {}
            } else {
                _suSetError('suVerifyError', '인증이 완료되지 않았습니다. 코드를 다시 확인해주세요.');
            }
        } catch (e) {
            _suSetError('suVerifyError', _clerkErr(e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '인증 완료'; }
        }
    };

    window._suResend = async function () {
        const Clerk = window.Clerk;
        if (!Clerk) return;
        try {
            await Clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            _suSetError('suVerifyError', '');
            try { window.snack?.('인증 코드를 다시 보냈습니다', 'info'); } catch (_) {}
        } catch (e) { _suSetError('suVerifyError', _clerkErr(e)); }
    };

    // ──────────────────────────────────────────────────────────
    // 비밀번호 재설정 (커스텀 — Clerk reset_password_email_code)
    // 1) 이메일 입력 → 코드 발송  2) 코드 + 새 비밀번호 → 재설정 + 자동 로그인
    // ──────────────────────────────────────────────────────────
    window.goReset = function () {
        const rs = document.getElementById('resetScreen');
        if (!rs) return;
        document.getElementById('resetEmailStep').style.display = '';
        document.getElementById('resetVerifyStep').style.display = 'none';
        _suSetError('rsError', ''); _suSetError('rsVerifyError', '');
        const e = document.getElementById('rsEmail'); if (e) e.value = '';
        const c = document.getElementById('rsCode'); if (c) c.value = '';
        const p = document.getElementById('rsPwd'); if (p) p.value = '';
        const p2 = document.getElementById('rsPwd2'); if (p2) p2.value = '';
        rs.style.display = '';
        document.body.style.overflow = 'hidden';
    };
    window.closeReset = function () {
        const rs = document.getElementById('resetScreen');
        if (rs) rs.style.display = 'none';
        document.body.style.overflow = '';
    };

    window._resetSendCode = async function () {
        const Clerk = window.Clerk;
        const btn = document.getElementById('rsSendBtn');
        _suSetError('rsError', '');
        if (!Clerk) { _suSetError('rsError', '현재 환경에서는 사용할 수 없습니다.'); return; }
        const email = (document.getElementById('rsEmail')?.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return _suSetError('rsError', '올바른 이메일을 입력해주세요.');
        if (btn) { btn.disabled = true; btn.textContent = '전송 중…'; }
        try {
            await Clerk.client.signIn.create({ strategy: 'reset_password_email_code', identifier: email });
            const echo = document.getElementById('rsEmailEcho');
            if (echo) echo.textContent = email;
            document.getElementById('resetEmailStep').style.display = 'none';
            document.getElementById('resetVerifyStep').style.display = '';
            _suSetError('rsVerifyError', '');
            setTimeout(() => document.getElementById('rsCode')?.focus(), 100);
        } catch (e) {
            _suSetError('rsError', _clerkErr(e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '이메일로 인증코드 받기'; }
        }
    };

    window._resetSubmit = async function () {
        const Clerk = window.Clerk;
        const btn = document.getElementById('rsResetBtn');
        _suSetError('rsVerifyError', '');
        if (!Clerk) return;
        const code = (document.getElementById('rsCode')?.value || '').trim();
        const pwd = document.getElementById('rsPwd')?.value || '';
        const pwd2 = document.getElementById('rsPwd2')?.value || '';
        if (!/^\d{6}$/.test(code)) return _suSetError('rsVerifyError', '6자리 인증 코드를 입력해주세요.');
        if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pwd)) return _suSetError('rsVerifyError', '비밀번호는 영문·숫자 포함 8자 이상이어야 합니다.');
        if (pwd !== pwd2) return _suSetError('rsVerifyError', '비밀번호가 일치하지 않습니다.');
        if (btn) { btn.disabled = true; btn.textContent = '재설정 중…'; }
        try {
            const res = await Clerk.client.signIn.attemptFirstFactor({
                strategy: 'reset_password_email_code', code, password: pwd,
            });
            if (res.status === 'complete') {
                await Clerk.setActive({ session: res.createdSessionId });
                window.closeReset();
                try { window.snack?.('비밀번호가 재설정되었습니다 — 로그인됨', 'success'); } catch (_) {}
            } else {
                _suSetError('rsVerifyError', '재설정이 완료되지 않았습니다. 코드를 다시 확인해주세요.');
            }
        } catch (e) {
            _suSetError('rsVerifyError', _clerkErr(e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '비밀번호 재설정'; }
        }
    };

    window._resetResend = async function () {
        const Clerk = window.Clerk;
        if (!Clerk) return;
        const email = (document.getElementById('rsEmail')?.value || '').trim();
        if (!email) return;
        try {
            await Clerk.client.signIn.create({ strategy: 'reset_password_email_code', identifier: email });
            _suSetError('rsVerifyError', '');
            try { window.snack?.('인증 코드를 다시 보냈습니다', 'info'); } catch (_) {}
        } catch (e) { _suSetError('rsVerifyError', _clerkErr(e)); }
    };
    // SNS OAuth — Google/Apple/Kakao 등
    window._loginOAuth = async function (strategy) {
        const Clerk = window.Clerk;
        if (!Clerk) return alert('Clerk 미초기화');
        try {
            await Clerk.client.signIn.authenticateWithRedirect({
                strategy,
                redirectUrl:        location.origin + location.pathname,
                redirectUrlComplete: location.origin + location.pathname,
            });
        } catch (e) {
            // 폴백 — 일반 모달
            console.warn('[auth] OAuth direct fail, fallback to modal', e);
            Clerk.openSignIn({ afterSignInUrl: location.href });
        }
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
