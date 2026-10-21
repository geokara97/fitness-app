// ============================================================
//  Native-feeling motion: interruptible springs, the iOS-style
//  bottom tab bar and spring-driven tab indicators.
// ============================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

// iOS Safari only applies :active (our press feedback) when the page
// has a touch listener. Passive, so it never blocks scrolling.
document.addEventListener('touchstart', () => {}, { passive: true });

// ---- Spring -------------------------------------------------
// Damped harmonic oscillator integrated per frame. Calling set()
// while moving retargets from the current position AND velocity,
// so a quick second tap bends the motion instead of restarting it.
// Parameters follow Apple's model: dampingRatio 1 = no overshoot,
// response = seconds to (roughly) reach the target.
class Spring {
    constructor({ value, response = 0.35, dampingRatio = 1, onUpdate, onRest } = {}) {
        this.x = [].concat(value ?? 0);
        this.v = this.x.map(() => 0);
        this.target = this.x.slice();
        this.k = (2 * Math.PI / response) ** 2;
        this.c = 4 * Math.PI * dampingRatio / response;
        this.m = 1;
        this.onUpdate = onUpdate;
        this.onRest = onRest;
        this.raf = 0;
        this.last = 0;
    }

    get value() { return this.x.length === 1 ? this.x[0] : this.x.slice(); }
    get velocity() { return this.v.length === 1 ? this.v[0] : this.v.slice(); }

    set(target, velocity) {
        this.target = [].concat(target);
        if (velocity !== undefined) this.v = [].concat(velocity);
        if (REDUCED_MOTION.matches) return this.jump(target);
        if (!this.raf) {
            this.last = performance.now();
            this.raf = requestAnimationFrame(t => this.step(t));
        }
    }

    jump(value) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.x = [].concat(value);
        this.target = this.x.slice();
        this.v = this.x.map(() => 0);
        this.onUpdate?.(this.value);
    }

    step(now) {
        // Fixed sub-steps keep the integration stable on slow frames.
        let dt = Math.min((now - this.last) / 1000, 0.064);
        this.last = now;
        const h = 1 / 240;
        while (dt > 0) {
            const s = Math.min(h, dt);
            for (let i = 0; i < this.x.length; i++) {
                const a = (-this.k * (this.x[i] - this.target[i]) - this.c * this.v[i]) / this.m;
                this.v[i] += a * s;
                this.x[i] += this.v[i] * s;
            }
            dt -= s;
        }
        const resting = this.x.every((x, i) =>
            Math.abs(x - this.target[i]) < 0.01 && Math.abs(this.v[i]) < 0.05);
        if (resting) {
            this.raf = 0;
            this.x = this.target.slice();
            this.v = this.x.map(() => 0);
            this.onUpdate?.(this.value);
            this.onRest?.(this.value);
            return;
        }
        this.onUpdate?.(this.value);
        this.raf = requestAnimationFrame(t => this.step(t));
    }
}

// ---- Sliding indicator -------------------------------------
// Puts a pill/underline behind the `.active` item of a tab group
// and springs it whenever the active class moves.
function attachTabIndicator(group, itemSelector, { className = 'tab-ink', from } = {}) {
    const ink = document.createElement('span');
    ink.className = className;
    ink.setAttribute('aria-hidden', 'true');
    group.prepend(ink);

    const measure = () => {
        const item = group.querySelector(itemSelector + '.active');
        return item ? [item.offsetLeft, item.offsetWidth] : null;
    };
    // Width is fixed once; size changes go through scaleX so every
    // frame is transform-only (no layout).
    const base = measure()?.[1] || 100;
    ink.style.width = `${base}px`;
    const spring = new Spring({
        value: from?.value ?? measure() ?? [0, base],
        onUpdate: ([x, w]) => {
            ink.style.transform = `translateX(${x}px) scaleX(${Math.max(0, w) / base})`;
        },
    });
    const sync = () => {
        const target = measure();
        ink.hidden = !target;
        if (target) spring.set(target);
    };
    spring.onUpdate(spring.value);
    if (from?.velocity) spring.v = [].concat(from.velocity);
    sync();

    // React to whatever code toggles `.active` — no page code changes needed.
    new MutationObserver(sync).observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => { const t = measure(); if (t) spring.jump(t); });
    return spring;
}

// Springs a freshly shown panel in from the side the user moved towards.
// Short distance: tab switches happen many times a day. With reduced
// motion it becomes a plain fade (no movement).
function springIn(el, direction = 1, distance = 16) {
    if (!el) return;
    if (REDUCED_MOTION.matches) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
        return;
    }
    if (el._springIn) el._springIn.jump(1);
    const s = new Spring({
        value: 0,
        response: 0.3,
        onUpdate: p => {
            el.style.transform = p >= 1 ? '' : `translateX(${(1 - p) * direction * distance}px)`;
            el.style.opacity = p >= 1 ? '' : Math.min(1, 0.4 + p);
        },
    });
    el._springIn = s;
    s.onUpdate(0);
    s.set(1);
}

// ---- Horizontal swipe --------------------------------------
// Commits on distance OR a quick flick, decided from the first
// clear horizontal move; vertical drags are left to page scroll.
function attachSwipe(el, { onLeft, onRight, threshold = 50 } = {}) {
    if (!el) return;
    el.style.touchAction = 'pan-y';          // we own horizontal, the browser keeps vertical
    let start = null;
    let suppressClickUntil = 0;              // a swipe is not a tap: drop the click right after it
    el.addEventListener('click', e => {
        if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
    }, { capture: true });
    el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' || start) return;   // touch/pen only; ignore extra fingers
        start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, axis: null };
    });
    el.addEventListener('pointermove', e => {
        if (!start || e.pointerId !== start.id || start.axis) return;
        const dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
        if (dx > 10 || dy > 10) start.axis = dx > dy ? 'x' : 'y';   // ~10px hysteresis
    });
    const end = e => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x;
        const velocity = Math.abs(dx) / (performance.now() - start.t);   // px/ms
        const horizontal = start.axis === 'x';
        start = null;
        if (!horizontal || (Math.abs(dx) < threshold && velocity < 0.4)) return;
        suppressClickUntil = performance.now() + 350;
        (dx < 0 ? onLeft : onRight)?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { start = null; });
}

// ---- Push / pop between pages -------------------------------
// Opening a sub-page slides it in from the right; the back button
// slides the parent in from the left (same path in and out).
const NAVDIR_KEY = 'fittrack-nav-dir';
document.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link || link.target || link.closest('.tab-bar') || e.defaultPrevented) return;
    const dir = link.classList.contains('nav-back') ? -1
        : (link.classList.contains('nav-card') || link.dataset.push !== undefined) ? 1 : 0;
    if (!dir) return;
    try { sessionStorage.setItem(NAVDIR_KEY, JSON.stringify({ dir, at: Date.now() })); } catch { /* ignore */ }
});
function playPushPop() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(NAVDIR_KEY) || 'null');
        sessionStorage.removeItem(NAVDIR_KEY);
        if (saved && Date.now() - saved.at < 2500) springIn(document.querySelector('.container'), saved.dir, 28);
    } catch { /* storage unavailable */ }
}

// iOS nav-bar back button: "‹ Exercise" moves from the page into the bar.
function initBackButton(nav) {
    const link = document.querySelector('.container > .back-link');
    if (!link) return;
    const back = document.createElement('a');
    back.className = 'nav-back';
    back.href = link.getAttribute('href');
    back.innerHTML = `<svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>`;
    back.querySelector('span').textContent = link.textContent.replace(/^\s*←\s*/, '');
    nav.prepend(back);
    document.body.classList.add('has-nav-back');
}

// ---- Large title -------------------------------------------
// iOS behaviour: the page's big heading scrolls away and its text
// appears small in the nav bar; the bar's hairline shows only once
// content is underneath it.
function initLargeTitle(nav) {
    const heading = document.querySelector('.page-head h1');
    const title = nav.querySelector('.nav-title');
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 2);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (!heading || !title || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(([entry]) => {
        title.textContent = heading.textContent;       // read late: headings are translated/renamed after load
        nav.classList.toggle('title-in', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { rootMargin: `-${nav.offsetHeight}px 0px 0px 0px` }).observe(heading);
}

// ---- Bottom tab bar ----------------------------------------
const TABBAR_KEY = 'fittrack-tabbar';
const TABBAR_TABS = [
    { id: 'dashboard', label: 'tab.dashboard', icon: '\u{1F3E0}', href: 'index.html' },
    { id: 'tracker', label: 'tab.tracker', icon: '\u{1F4CA}', href: 'tracker.html' },
    { id: 'nutrition', label: 'tab.nutrition', icon: '\u{1F957}', href: 'nutrition.html' },
    { id: 'exercise', label: 'tab.exercise', icon: '\u{1F3CB}\u{FE0F}', href: 'exercise.html' },
    { id: 'settings', label: 'tab.settings', icon: '\u{2699}\u{FE0F}', href: 'settings.html' },
];

function renderTabBar(active) {
    if (document.getElementById('tab-bar')) return;
    const bar = document.createElement('nav');
    bar.id = 'tab-bar';
    bar.className = 'tab-bar';
    bar.setAttribute('aria-label', t('nav.menu'));
    bar.innerHTML = TABBAR_TABS.map(tab => `
        <a href="${tab.href}" class="tab-item ${tab.id === active ? 'active' : ''}" data-tab-id="${tab.id}"
           ${tab.id === active ? 'aria-current="page"' : ''}>
            <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
            <span class="tab-label">${t(tab.label)}</span>
        </a>`).join('');
    document.body.appendChild(bar);

    // Continue the pill's motion from where the previous page left it.
    let carried = null;
    try {
        const saved = JSON.parse(sessionStorage.getItem(TABBAR_KEY) || 'null');
        sessionStorage.removeItem(TABBAR_KEY);
        if (saved && Date.now() - saved.at < 2500) carried = saved;
    } catch { /* storage unavailable: start at rest */ }

    const spring = attachTabIndicator(bar, '.tab-item', {
        className: 'tab-pill',
        from: carried && { value: carried.value, velocity: carried.velocity },
    });

    const index = id => TABBAR_TABS.findIndex(tab => tab.id === id);
    if (carried && carried.from !== active) {
        springIn(document.querySelector('.container'), Math.sign(index(active) - index(carried.from)) || 1);
    }

    bar.addEventListener('click', e => {
        const item = e.target.closest('.tab-item');
        if (!item) return;
        // Start moving now; the next page picks up position + velocity.
        bar.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el === item));
        const save = () => {
            try {
                sessionStorage.setItem(TABBAR_KEY, JSON.stringify({
                    from: active, value: spring.value, velocity: spring.velocity, at: Date.now(),
                }));
            } catch { /* ignore */ }
        };
        save();
        window.addEventListener('pagehide', save, { once: true });
    });

    // Back/forward cache restores the old page: put the pill back.
    window.addEventListener('pageshow', e => {
        if (!e.persisted) return;
        bar.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.tabId === active));
    });
}
