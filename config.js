// ============================================================
// FitTrack Personal — shared config, Supabase client & helpers
// ============================================================

// ---- Supabase credentials -----------------------------------
const SUPABASE_URL = 'https://qzmtwcpmqsxzozprpzta.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bXR3Y3BtcXN4em96cHJwenRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzM3OTYsImV4cCI6MjEwODE0OTc5Nn0.DnnZL7xKyYmLdpT0pOJDhRm2WRsDKRGpLt7jNPejxic';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- USDA FoodData Central (food macro lookup) ---------------
// 'DEMO_KEY' works but is limited to ~30 searches/hour. Get a free
// personal key at https://fdc.nal.usda.gov/api-key-signup and paste it here.
const USDA_API_KEY = 'GhmLrKJgchfcG7fFFqw7jDdqCp6cj7cdt6zPgzHR';

// 7,700 kcal is roughly the energy in 1 kg of body fat.
const KCAL_PER_KG_FAT = 7700;

// ============================================================
// Profile — cached single config row
// ============================================================
let PROFILE = null;

async function loadProfile() {
    if (PROFILE) return PROFILE;
    const { data, error } = await db.from('profile').select('*').eq('id', 1).single();
    if (error) {
        console.error('Could not load profile:', error.message);
        showToast(t('common.profileError'), 'error');
        throw error;
    }
    PROFILE = data;
    return PROFILE;
}

function clearProfileCache() { PROFILE = null; }

// ============================================================
// Calorie maths — mirrors the Excel "Settings" sheet formulas
// ============================================================

// Mifflin-St Jeor Basal Metabolic Rate.
function calcBMR(weightKg, p) {
    const base = (10 * weightKg) + (6.25 * p.height_cm) - (5 * p.age);
    return base + (p.gender === 'Male' ? 5 : -161);
}

// Resting burn = BMR scaled by the NEAT multiplier (light job + steps).
function calcRestingBurn(weightKg, p) {
    return calcBMR(weightKg, p) * Number(p.neat_multiplier);
}

// Walking burn — scales with bodyweight relative to the 90 kg baseline.
function calcStepsBurn(steps, weightKg, p) {
    if (!steps) return 0;
    return (steps / 1000) * Number(p.walking_kcal_per_1000) * (weightKg / 90);
}

// Workout burn — bodyweight x rate x minutes timed (THE timer integration).
function calcWorkoutBurn(weightKg, minutes, p) {
    if (!minutes) return 0;
    return weightKg * Number(p.lifting_kcal_per_kg_min) * minutes;
}

// Total calories burned for a day.
function calcTotalBurned(weightKg, steps, workoutBurn, p) {
    return calcRestingBurn(weightKg, p) + calcStepsBurn(steps, weightKg, p) + (workoutBurn || 0);
}

// Fat-loss macros for a daily calorie target:
// protein 2.25 g per kg bodyweight (keeps muscle in a deficit),
// fat 25% of calories but never under 0.6 g/kg (hormonal health),
// carbs fill the remaining calories (fuel for training).
const MACRO_RULES = { proteinPerKg: 2.25, fatShare: 0.25, minFatPerKg: 0.6 };

// 'auto' = macros follow the rule above; 'custom' = the user typed their own.
// Kept in this browser (like the language), read by Settings and the Tracker.
const MACRO_MODE_KEY = 'fittrack-macro-mode';
function getMacroMode() {
    try { return localStorage.getItem(MACRO_MODE_KEY) === 'custom' ? 'custom' : 'auto'; } catch { return 'auto'; }
}
function setMacroMode(mode) {
    try { localStorage.setItem(MACRO_MODE_KEY, mode); } catch { /* storage unavailable */ }
}
// ---- Daily calories from the weight goal -----------------------
// 'auto' = worked out from goal weight + target date; 'custom' = typed in.
// Kept in this browser like the macro mode.
const KCAL_MODE_KEY = 'fittrack-kcal-mode';
function getKcalMode() {
    try { return localStorage.getItem(KCAL_MODE_KEY) === 'custom' ? 'custom' : 'auto'; } catch { return 'auto'; }
}
function setKcalMode(mode) {
    try { localStorage.setItem(KCAL_MODE_KEY, mode); } catch { /* storage unavailable */ }
}

// Never plan below these, whatever the goal asks for.
const MIN_DAILY_KCAL = { Male: 1500, Female: 1200 };

// Average daily burn for planning: resting + 10,000 steps + 5 workouts a week.
function calcAverageTdee(weightKg, p) {
    return calcRestingBurn(weightKg, p) + calcStepsBurn(10000, weightKg, p)
        + calcWorkoutBurn(weightKg, Number(p.lifting_default_min), p) * 5 / 7;
}

// Calories a day to reach the goal weight by the target date
// (1 kg of fat ≈ 7,700 kcal). Returns { ok, kcal, ... } or { ok: false, reason }.
function calcGoalCalories(p, weightKg, todayIso = todayISO()) {
    const tdee = calcAverageTdee(weightKg, p);
    const goal = Number(p.goal_weight);
    if (!p.goal_date || !goal) return { ok: false, reason: 'noDate', tdee };
    const days = Math.round((new Date(p.goal_date + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000);
    if (days <= 0) return { ok: false, reason: 'pastDate', tdee, days };
    const toLose = weightKg - goal;
    if (toLose <= 0) return { ok: true, reached: true, kcal: Math.round(tdee / 10) * 10, tdee, days, toLose: 0, deficit: 0 };

    const deficit = toLose * KCAL_PER_KG_FAT / days;             // needed every day
    const rawKcal = tdee - deficit;
    const floor = MIN_DAILY_KCAL[p.gender] || MIN_DAILY_KCAL.Female;
    const kcal = Math.max(floor, Math.round(rawKcal / 10) * 10);
    const actualDeficit = tdee - kcal;
    const weeklyLoss = actualDeficit * 7 / KCAL_PER_KG_FAT;
    const clamped = rawKcal < floor;
    // At the floor the goal takes longer: when you would get there.
    const reachDays = actualDeficit > 0 ? Math.ceil(toLose * KCAL_PER_KG_FAT / actualDeficit) : null;
    return { ok: true, kcal, rawKcal, tdee, days, toLose, deficit, floor, clamped,
             weeklyLoss, aggressive: weeklyLoss > weightKg * 0.01, reachDays };
}

// Auto targets (calories and/or macros) can go stale as days pass and weigh-ins
// come in. Bring the stored profile up to date and return it.
async function syncAutoTargets() {
    const p = await loadProfile();
    const { data: latest } = await db.from('weight_log')
        .select('weight').order('log_date', { ascending: false }).limit(1);
    const weight = latest && latest.length ? Number(latest[0].weight) : Number(p.current_weight);

    const patch = {};
    if (weight && Number(p.current_weight) !== weight) patch.current_weight = weight;
    let kcal = Number(p.daily_calorie_target);
    if (getKcalMode() === 'auto') {
        const g = calcGoalCalories(p, weight);
        if (g.ok && g.kcal !== kcal) { kcal = g.kcal; patch.daily_calorie_target = kcal; }
    }
    if (getMacroMode() === 'auto') {
        const m = calcMacroTargets(kcal, weight);
        for (const [k, v] of Object.entries(m)) if (Number(p[k]) !== v) patch[k] = v;
    }
    if (!Object.keys(patch).length) return p;
    const { error } = await db.from('profile').update(patch).eq('id', 1);
    if (error) return p;
    clearProfileCache();
    return loadProfile();
}

function calcMacroTargets(kcal, weightKg) {
    kcal = Number(kcal) || 0;
    weightKg = Number(weightKg) || 0;
    const protein = Math.round(weightKg * MACRO_RULES.proteinPerKg);
    let fat = Math.round(Math.max(kcal * MACRO_RULES.fatShare / 9, weightKg * MACRO_RULES.minFatPerKg));
    let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
    if (carbs < 0) {                     // very low targets: protein first, then fat, no carbs
        carbs = 0;
        fat = Math.max(0, Math.round((kcal - protein * 4) / 9));
    }
    return { protein_target: protein, carbs_target: carbs, fat_target: fat };
}

// ============================================================
// Date & formatting helpers
// ============================================================
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString + (dateString.length === 10 ? 'T00:00:00' : ''));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cmp = new Date(date); cmp.setHours(0, 0, 0, 0);
    const diff = Math.round((today - cmp) / 86400000);
    if (diff === 0) return t('date.today');
    if (diff === 1) return t('date.yesterday');
    return date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(h > 0 ? m : m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Decimal typed by the user: accepts "88.5" and "88,5" (Greek keyboards type a comma).
// Returns null for empty or invalid input.
function parseDecimal(value) {
    const s = String(value ?? '').trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

// Decimal text fields (type="text" inputmode="decimal") accept only digits and one separator.
document.addEventListener('input', e => {
    const el = e.target;
    if (!el.matches || !el.matches('input[type="text"][inputmode="decimal"]')) return;
    const clean = el.value.replace(/[^0-9.,]/g, '').replace(/([.,].*)[.,]/g, '$1');
    if (clean !== el.value) el.value = clean;
}, true);

function round(n, dp = 0) {
    if (n === null || n === undefined || isNaN(n)) return 0;
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
}

// Escape text before putting it into innerHTML (food names come from users & APIs).
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dayName(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

// ============================================================
// Toast notifications
// ============================================================
function showToast(message, type = 'success') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}

// In-app yes/no confirmation shown like a toast (instead of the browser's confirm()).
// Resolves true for OK, false for Cancel / Escape. Only one is shown at a time.
function confirmToast(message, { okText, cancelText } = {}) {
    document.getElementById('confirm-toast')?._resolve?.(false);
    return new Promise(resolve => {
        const box = document.createElement('div');
        box.id = 'confirm-toast';
        box.className = 'confirm-toast';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'false');
        box.innerHTML = `
            <p class="confirm-msg"></p>
            <div class="confirm-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-ans="no"></button>
                <button type="button" class="btn btn-danger btn-sm" data-ans="yes"></button>
            </div>`;
        box.querySelector('.confirm-msg').textContent = message;
        box.querySelector('[data-ans="no"]').textContent = cancelText || t('common.cancel');
        box.querySelector('[data-ans="yes"]').textContent = okText || t('common.ok');

        const onKey = e => { if (e.key === 'Escape') finish(false); };
        function finish(answer) {
            document.removeEventListener('keydown', onKey);
            box.classList.remove('show');
            setTimeout(() => box.remove(), 250);
            resolve(answer);
        }
        box._resolve = finish;
        box.addEventListener('click', e => {
            const btn = e.target.closest('[data-ans]');
            if (btn) { e.stopPropagation(); finish(btn.dataset.ans === 'yes'); }
        });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(box);
        void box.offsetWidth;          // apply the start position so the slide-in animates
        box.classList.add('show');
        box.querySelector('[data-ans="no"]').focus();
    });
}

// ============================================================
// Shared top navigation — injected into every page
// ============================================================
function renderNav(active) {
    const links = [
        { id: 'dashboard', label: t('nav.dashboard'), icon: '\u{1F3E0}', href: 'index.html' },
        { id: 'tracker', label: t('nav.tracker'), icon: '\u{1F4CA}', href: 'tracker.html' },
        { id: 'nutrition', label: t('nav.nutrition'), icon: '\u{1F957}', href: 'nutrition.html' },
        { id: 'exercise', label: t('nav.exercise'), icon: '\u{1F3CB}\u{FE0F}', href: 'exercise.html' },
        { id: 'settings', label: t('nav.settings'), icon: '\u{2699}\u{FE0F}', href: 'settings.html' },
    ];
    const el = document.getElementById('app-nav');
    if (!el) return;
    el.innerHTML = `
        <a href="index.html" class="nav-brand">\u{1F4AA} FitTrack</a>
        <span class="nav-title" aria-hidden="true"></span>
        <button class="nav-toggle" aria-label="${t('nav.menu')}">☰</button>
        <button class="lang-toggle" title="${t('nav.switchTitle')}">${t('nav.switchTo')}</button>
        <div class="nav-links">
            ${links.map(l => `
                <a href="${l.href}" class="nav-link ${l.id === active ? 'active' : ''}">
                    <span>${l.icon}</span> ${l.label}
                </a>`).join('')}
        </div>`;
    el.querySelector('.nav-toggle').addEventListener('click', () => {
        el.querySelector('.nav-links').classList.toggle('open');
    });
    el.querySelector('.lang-toggle').addEventListener('click', () => {
        setLang(LANG === 'el' ? 'en' : 'el');
    });
    // iOS-style bottom tab bar and large-title nav on phones (motion.js).
    if (typeof renderTabBar === 'function') renderTabBar(active);
    if (typeof initLargeTitle === 'function') initLargeTitle(el);
    if (typeof initBackButton === 'function') initBackButton(el);
    if (typeof playPushPop === 'function') playPushPop();
    // Running workout timer bar (workout-session.js).
    if (typeof renderSessionBar === 'function') renderSessionBar(el);
}
