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
}
