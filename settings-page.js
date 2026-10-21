// ============================================================
// Settings page
// ============================================================

const FIELDS = {
    's-name': 'name', 's-age': 'age', 's-gender': 'gender', 's-height': 'height_cm',
    's-activity': 'activity_level', 's-start': 'start_weight', 's-current': 'current_weight',
    's-goal': 'goal_weight', 's-goaldate': 'goal_date',
    's-lift-rate': 'lifting_kcal_per_kg_min', 's-lift-min': 'lifting_default_min',
    's-walk': 'walking_kcal_per_1000', 's-neat': 'neat_multiplier',
    's-kcal': 'daily_calorie_target', 's-protein': 'protein_target',
    's-carbs': 'carbs_target', 's-fat': 'fat_target',
};
const NUMERIC = new Set([
    'age', 'height_cm', 'start_weight', 'current_weight', 'goal_weight',
    'lifting_kcal_per_kg_min', 'lifting_default_min', 'walking_kcal_per_1000',
    'neat_multiplier', 'daily_calorie_target', 'protein_target', 'carbs_target', 'fat_target',
]);

let profile = null;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('settings');

    // Language switch (segmented control)
    const langTabs = document.querySelectorAll('.lang-seg .main-tab');
    langTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === LANG);
        tab.addEventListener('click', () => { if (tab.dataset.lang !== LANG) setLang(tab.dataset.lang); });
    });
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.querySelector('.lang-seg'), '.main-tab');

    try {
        profile = await loadProfile();
    } catch (e) { return; }

    for (const [elId, col] of Object.entries(FIELDS)) {
        const el = document.getElementById(elId);
        el.value = profile[col] ?? '';
        el.addEventListener('input', recompute);
        el.addEventListener('change', () => { recompute(); scheduleSave(); });
    }
    document.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById('s-kcal');
        input.value = Math.max(800, Number(input.value || 0) + Number(btn.dataset.step));
        recompute();
        scheduleSave();
    }));
    document.getElementById('settings-form').addEventListener('submit', e => {
        e.preventDefault();
        document.activeElement?.blur();
    });
    recompute();

    // Stored macros from before the automatic rule: bring them in line once.
    const p = formProfile();
    if (p.protein_target !== Number(profile.protein_target) || p.carbs_target !== Number(profile.carbs_target)
        || p.fat_target !== Number(profile.fat_target)) save();
});

// Build a profile-like object from current form values.
function formProfile() {
    const p = {};
    for (const [elId, col] of Object.entries(FIELDS)) {
        const raw = document.getElementById(elId).value;
        p[col] = NUMERIC.has(col) ? (raw === '' ? 0 : Number(raw)) : raw;
    }
    return p;
}

function recompute() {
    const p = formProfile();
    const w = p.current_weight || p.start_weight || 90;

    // Macros follow the calorie target and bodyweight (see calcMacroTargets in config.js).
    const macros = calcMacroTargets(p.daily_calorie_target, w);
    document.getElementById('s-protein').value = macros.protein_target;
    document.getElementById('s-carbs').value = macros.carbs_target;
    document.getElementById('s-fat').value = macros.fat_target;
    renderMacros(macros, p.daily_calorie_target, w);

    const bmr = calcBMR(w, p);
    const resting = calcRestingBurn(w, p);
    const stepsBurn = calcStepsBurn(10000, w, p);
    const liftBurn = calcWorkoutBurn(w, p.lifting_default_min, p);
    const restTdee = resting + stepsBurn;
    document.getElementById('c-bmr').textContent = `${round(bmr)} kcal`;
    document.getElementById('c-resting').textContent = `${round(resting)} kcal`;
    document.getElementById('c-train').textContent = `${round(resting + stepsBurn + liftBurn)} kcal`;
    document.getElementById('c-rest').textContent = `${round(restTdee)} kcal`;
    const deficit = round(restTdee - p.daily_calorie_target);
    const defEl = document.getElementById('c-deficit');
    defEl.textContent = `${deficit} kcal`;
    defEl.classList.toggle('good', deficit > 0);
    defEl.classList.toggle('bad', deficit <= 0);

    renderProfileHeader(p, w);
}

function renderMacros(m, kcal, weight) {
    const kc = { p: m.protein_target * 4, c: m.carbs_target * 4, f: m.fat_target * 9 };
    const total = kc.p + kc.c + kc.f || 1;
    const pct = k => Math.round((kc[k] / total) * 100);
    document.getElementById('m-p').textContent = `${m.protein_target} g`;
    document.getElementById('m-c').textContent = `${m.carbs_target} g`;
    document.getElementById('m-f').textContent = `${m.fat_target} g`;
    document.getElementById('m-p-sub').textContent = `${pct('p')}% · ${round(m.protein_target / weight, 2)} g/kg`;
    document.getElementById('m-c-sub').textContent = `${pct('c')}% · ${round(kc.c)} kcal`;
    document.getElementById('m-f-sub').textContent = `${pct('f')}% · ${round(kc.f)} kcal`;
    document.getElementById('mb-p').style.width = pct('p') + '%';
    document.getElementById('mb-c').style.width = pct('c') + '%';
    document.getElementById('mb-f').style.width = pct('f') + '%';
    document.getElementById('macro-rule').textContent =
        t('set.macroRule', { g: MACRO_RULES.proteinPerKg, w: round(weight, 1) });
}

function renderProfileHeader(p, w) {
    const name = (p.name || '').trim();
    document.getElementById('pf-name').textContent = name || t('set.profile');
    document.getElementById('pf-avatar').textContent =
        name ? name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() : '💪';
    const start = p.start_weight || w, goal = p.goal_weight;
    const toGo = round(w - goal, 1);
    document.getElementById('pf-sub').textContent = goal
        ? `${w} kg → ${goal} kg · ${toGo > 0 ? t('set.toGo', { n: toGo }) : t('set.goalReached')}`
        : `${w} kg`;
    const done = start > goal ? Math.min(100, Math.max(0, ((start - w) / (start - goal)) * 100)) : 0;
    document.getElementById('pf-bar').style.width = done + '%';
}

// ---- Saving: every change commits on its own ----------------
let saveTimer = null;

function scheduleSave() {
    clearTimeout(saveTimer);
    setSaveStatus('saving');
    saveTimer = setTimeout(save, 500);
}

function setSaveStatus(state) {
    const el = document.getElementById('save-status');
    el.className = 'save-status' + (state ? ' ' + state : '');
    el.textContent = state === 'saving' ? t('trk.saving') : state === 'saved' ? '✓ ' + t('trk.savedShort') : '';
}

async function save() {
    const payload = formProfile();
    if (!payload.goal_date) payload.goal_date = null;
    try {
        const { error } = await db.from('profile').update(payload).eq('id', 1);
        if (error) throw error;
        clearProfileCache();
        setSaveStatus('saved');
    } catch (err) {
        setSaveStatus('');
        showToast(t('common.errorSaving', { msg: err.message }), 'error');
    }
}
