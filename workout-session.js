// ============================================================
// Workout session — persists the timer (and the workout form draft)
// in localStorage so a session keeps counting across pages, tabs and
// browser restarts. Also renders the floating session bar shown on
// every page except the workout log.
//
// Elapsed time is computed from wall-clock timestamps:
//   elapsed = accumulatedMs + (now - segmentStart while running)
// so nothing needs to "tick" in the background.
// ============================================================

const SESSION_KEY = 'fittrack-workout-session';
const SESSION_EVENT = 'fittrack-session-change';

// state: 'idle' | 'running' | 'paused' | 'stopped'
function readSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function writeSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

function blankSession() {
    return { state: 'idle', accumulatedMs: 0, segmentStart: null, bodyweight: null, rate: null,
             manualCalories: null, draft: null };
}

// Merge fields into the session, creating it if needed.
function updateSession(patch) {
    const s = { ...(readSession() || blankSession()), ...patch };
    writeSession(s);
    return s;
}

function sessionElapsedMs(s) {
    if (!s) return 0;
    let ms = s.accumulatedMs || 0;
    if (s.state === 'running' && s.segmentStart) ms += Math.max(0, Date.now() - s.segmentStart);
    return ms;
}

function sessionAutoCalories(s) {
    if (!s || !s.bodyweight || !s.rate) return 0;
    return Number(s.bodyweight) * Number(s.rate) * (sessionElapsedMs(s) / 60000);
}

// The smartwatch value when the user typed one, else the timer-based estimate.
function sessionCalories(s) {
    return (s && s.manualCalories != null) ? Number(s.manualCalories) : sessionAutoCalories(s);
}

function sessionIsActive(s) {
    return !!s && ['running', 'paused', 'stopped'].includes(s.state);
}

function sessionStart(defaults = {}) {
    const s = readSession() || blankSession();
    if (s.state === 'running') return s;
    return updateSession({ ...defaults, state: 'running', segmentStart: Date.now(),
                           bodyweight: defaults.bodyweight ?? s.bodyweight, rate: defaults.rate ?? s.rate });
}

function sessionPause() {
    const s = readSession();
    if (!s || s.state !== 'running') return s;
    return updateSession({ state: 'paused', accumulatedMs: sessionElapsedMs(s), segmentStart: null });
}

function sessionStop() {
    const s = readSession();
    if (!s || !['running', 'paused'].includes(s.state)) return s;
    return updateSession({ state: 'stopped', accumulatedMs: sessionElapsedMs(s), segmentStart: null });
}

// Timer back to 00:00; the form draft and any typed calories are kept.
function sessionResetTimer() {
    return updateSession({ state: 'idle', accumulatedMs: 0, segmentStart: null });
}

// Run fn whenever the session changes in this tab or another one.
function onSessionChange(fn) {
    window.addEventListener(SESSION_EVENT, fn);
    window.addEventListener('storage', e => { if (e.key === SESSION_KEY || e.key === null) fn(); });
}


// ============================================================
// Floating session bar (called from renderNav on every page)
// ============================================================
let sessionBarTick = null;

function renderSessionBar(navEl) {
    if (document.body.dataset.page === 'workout') return;   // the workout log has the full timer
    let bar = document.getElementById('session-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'session-bar';
        bar.className = 'session-bar';
        bar.setAttribute('role', 'link');
        bar.tabIndex = 0;
        bar.innerHTML = `
            <span class="sb-dot" aria-hidden="true"></span>
            <span class="sb-label"></span>
            <span class="sb-time"></span>
            <span class="sb-kcal"></span>
            <span class="sb-actions">
                <button type="button" class="sb-btn" data-sb="pause">⏸</button>
                <button type="button" class="sb-btn" data-sb="resume">▶</button>
                <button type="button" class="sb-btn sb-stop" data-sb="stop">⏹</button>
            </span>`;
        bar.title = t('sb.open');
        bar.querySelector('[data-sb="pause"]').title = t('sb.pause');
        bar.querySelector('[data-sb="resume"]').title = t('sb.resume');
        bar.querySelector('[data-sb="stop"]').title = t('sb.stop');

        bar.addEventListener('click', e => {
            const btn = e.target.closest('[data-sb]');
            if (!btn) { window.location.href = 'workout.html'; return; }
            e.stopPropagation();
            if (btn.dataset.sb === 'pause') sessionPause();
            if (btn.dataset.sb === 'resume') sessionStart();
            if (btn.dataset.sb === 'stop') {
                if (!confirm(t('wo.confirmStop'))) return;
                sessionStop();
                window.location.href = 'workout.html#report';   // review & save the session
            }
        });
        bar.addEventListener('keydown', e => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === bar) {
                e.preventDefault();
                window.location.href = 'workout.html';
            }
        });
        navEl.appendChild(bar);
        onSessionChange(updateSessionBar);
    }
    updateSessionBar();
}

function updateSessionBar() {
    const bar = document.getElementById('session-bar');
    if (!bar) return;
    const s = readSession();
    const active = sessionIsActive(s);
    bar.hidden = !active;
    clearInterval(sessionBarTick);
    if (!active) return;

    bar.className = `session-bar state-${s.state}`;
    bar.querySelector('.sb-label').textContent = t('sb.' + s.state);
    bar.querySelector('[data-sb="pause"]').hidden = s.state !== 'running';
    bar.querySelector('[data-sb="resume"]').hidden = s.state !== 'paused';
    bar.querySelector('[data-sb="stop"]').hidden = s.state === 'stopped';

    const paint = () => {
        const cur = readSession() || s;
        bar.querySelector('.sb-time').textContent = formatClock(sessionElapsedMs(cur) / 1000);
        bar.querySelector('.sb-kcal').textContent = `🔥 ${round(sessionCalories(cur))} kcal`;
    };
    paint();
    if (s.state === 'running') sessionBarTick = setInterval(paint, 1000);
}
