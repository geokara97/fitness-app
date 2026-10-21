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
const MACRO_IDS = ['s-protein', 's-carbs', 's-fat'];

// Activity level → NEAT multiplier (BMR × this = resting daily burn).
// Lower than the usual 1.2–1.9 activity factors on purpose: steps and
// workouts are counted separately, so they must not be included here too.
const ACTIVITY_NEAT = {
    'Sedentary (desk job)': 1.2,
    'Lightly active': 1.3,
    'Moderately active': 1.4,
    'Very active': 1.5,
};

let profile = null;
let savedSnapshot = '';          // form state as last saved, to know when there are changes
let savedMode = 'auto';
let macroMode = getMacroMode();
let kcalMode = getKcalMode();      // 'auto' = from goal weight + target date
let savedKcalMode = kcalMode;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('settings');

    // Language switch (segmented control) — applies immediately, not part of the profile
    document.querySelectorAll('.lang-seg .main-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === LANG);
        tab.addEventListener('click', () => { if (tab.dataset.lang !== LANG) setLang(tab.dataset.lang); });
    });
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.querySelector('.lang-seg'), '.main-tab');

    try {
        // Latest weigh-in as current weight, and auto calories/macros brought up to date.
        profile = await syncAutoTargets();
    } catch (e) { return; }

    for (const [elId, col] of Object.entries(FIELDS)) {
        const el = document.getElementById(elId);
        el.value = profile[col] ?? '';
        el.addEventListener('input', onFormEdit);
        el.addEventListener('change', onFormEdit);
    }
    // Picking an activity level fills in its NEAT multiplier (still editable by hand);
    // typing a multiplier that matches a level selects that level.
    const activity = document.getElementById('s-activity');
    const neat = document.getElementById('s-neat');
    activity.addEventListener('change', () => {
        neat.value = ACTIVITY_NEAT[activity.value];
        onFormEdit();
    });
    neat.addEventListener('change', () => {
        const match = Object.keys(ACTIVITY_NEAT).find(k => ACTIVITY_NEAT[k] === parseDecimal(neat.value));
        if (match && match !== activity.value) { activity.value = match; onFormEdit(); }
    });

    document.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
        // Stepping your own number means Custom calories.
        if (kcalMode === 'auto') setKcalModeUI('custom', { initial: true });
        const input = document.getElementById('s-kcal');
        input.value = Math.max(800, Number(input.value || 0) + Number(btn.dataset.step));
        onFormEdit();
    }));

    // Calories mode: From goal (worked out) / Custom (typed in)
    document.querySelectorAll('#kcal-mode .main-tab').forEach(tab =>
        tab.addEventListener('click', () => setKcalModeUI(tab.dataset.mode)));
    setKcalModeUI(kcalMode, { initial: true });
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.getElementById('kcal-mode'), '.main-tab');

    // Macro mode: Auto (worked out) / Custom (typed in)
    document.querySelectorAll('#macro-mode .main-tab').forEach(tab =>
        tab.addEventListener('click', () => setMode(tab.dataset.mode)));
    setMode(macroMode, { initial: true });
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.getElementById('macro-mode'), '.main-tab');

    savedSnapshot = snapshot();
    savedMode = macroMode;
    savedKcalMode = kcalMode;
    updateDirty();

    document.getElementById('settings-form').addEventListener('submit', save);
    window.addEventListener('beforeunload', e => {
        if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
});

// Build a profile-like object from current form values.
function formProfile() {
    const p = {};
    for (const [elId, col] of Object.entries(FIELDS)) {
        const raw = document.getElementById(elId).value;
        p[col] = NUMERIC.has(col) ? (parseDecimal(raw) ?? 0) : raw;
    }
    return p;
}

function snapshot() { return JSON.stringify(formProfile()); }
function isDirty() { return snapshot() !== savedSnapshot || macroMode !== savedMode || kcalMode !== savedKcalMode; }
function updateDirty() {
    const btn = document.getElementById('btn-save');
    btn.disabled = !isDirty();
}

function onFormEdit() {
    recompute();
    updateDirty();
}

function setKcalModeUI(mode, { initial = false } = {}) {
    kcalMode = mode;
    document.querySelectorAll('#kcal-mode .main-tab').forEach(tab =>
        tab.classList.toggle('active', tab.dataset.mode === mode));
    // From goal: the number is worked out, so it is read-only and the stepper hides.
    document.getElementById('s-kcal').readOnly = mode === 'auto';
    document.querySelector('.stepper').classList.toggle('locked', mode === 'auto');
    recompute();
    if (!initial) {
        updateDirty();
        if (mode === 'custom') document.getElementById('s-kcal').focus();
    }
}

function setMode(mode, { initial = false } = {}) {
    macroMode = mode;
    document.querySelectorAll('#macro-mode .main-tab').forEach(tab =>
        tab.classList.toggle('active', tab.dataset.mode === mode));
    MACRO_IDS.forEach(id => { document.getElementById(id).readOnly = mode === 'auto'; });
    document.querySelector('.macro-split').classList.toggle('custom', mode === 'custom');
    recompute();
    if (!initial) {
        updateDirty();
        if (mode === 'custom') document.getElementById('s-protein').focus();
    }
}

function recompute() {
    let p = formProfile();
    const w = p.current_weight || p.start_weight || 90;

    // From goal: calories that reach the goal weight by the target date.
    const goal = calcGoalCalories(p, w);
    if (kcalMode === 'auto' && goal.ok) {
        document.getElementById('s-kcal').value = goal.kcal;
        p = formProfile();
    }
    renderGoalRule(goal, p, w);

    // Auto: macros follow the calorie target and bodyweight (calcMacroTargets in config.js).
    if (macroMode === 'auto') {
        const m = calcMacroTargets(p.daily_calorie_target, w);
        document.getElementById('s-protein').value = m.protein_target;
        document.getElementById('s-carbs').value = m.carbs_target;
        document.getElementById('s-fat').value = m.fat_target;
    }
    renderMacros(formProfile(), w);

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

// The sum behind the calorie target, plus any warning.
function renderGoalRule(g, p, w) {
    const el = document.getElementById('goal-rule');
    el.classList.remove('warn');
    if (kcalMode === 'custom') {
        // Custom: still show what the goal would need, for comparison.
        el.textContent = g.ok && !g.reached ? t('set.goalHint', { kcal: g.kcal.toLocaleString(LOCALE) }) : '';
        return;
    }
    if (!g.ok) {
        el.textContent = t(g.reason === 'pastDate' ? 'set.goalPast' : 'set.goalNoDate');
        el.classList.add('warn');
        return;
    }
    if (g.reached) { el.textContent = t('set.goalReachedKcal', { kcal: g.kcal.toLocaleString(LOCALE) }); return; }
    const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
    let text = t('set.goalCalc', {
        from: round(w, 1), to: round(Number(p.goal_weight), 1), date: fmtDate(p.goal_date), days: g.days,
        kg: round(g.toLose, 1), total: Math.round(g.toLose * KCAL_PER_KG_FAT).toLocaleString(LOCALE),
        deficit: Math.round(g.deficit).toLocaleString(LOCALE), tdee: Math.round(g.tdee).toLocaleString(LOCALE),
        kcal: g.kcal.toLocaleString(LOCALE), rate: round(g.weeklyLoss, 2),
    });
    if (g.clamped) {
        const reach = new Date(todayISO() + 'T00:00:00');
        reach.setDate(reach.getDate() + (g.reachDays || 0));
        const reachIso = `${reach.getFullYear()}-${String(reach.getMonth() + 1).padStart(2, '0')}-${String(reach.getDate()).padStart(2, '0')}`;
        text += ' ' + t('set.goalFloor', { raw: Math.round(g.rawKcal).toLocaleString(LOCALE), floor: g.floor.toLocaleString(LOCALE), date: fmtDate(reachIso) });
        el.classList.add('warn');
    } else if (g.aggressive) {
        text += ' ' + t('set.goalAggressive');
        el.classList.add('warn');
    }
    el.textContent = text;
}

function renderMacros(p, weight) {
    const kc = { p: p.protein_target * 4, c: p.carbs_target * 4, f: p.fat_target * 9 };
    const sum = kc.p + kc.c + kc.f;
    const pct = k => Math.round((kc[k] / (sum || 1)) * 100);
    document.getElementById('m-p-sub').textContent = `${pct('p')}% · ${round(p.protein_target / weight, 2)} g/kg`;
    document.getElementById('m-c-sub').textContent = `${pct('c')}% · ${round(kc.c)} kcal`;
    document.getElementById('m-f-sub').textContent = `${pct('f')}% · ${round(kc.f)} kcal`;
    document.getElementById('mb-p').style.width = pct('p') + '%';
    document.getElementById('mb-c').style.width = pct('c') + '%';
    document.getElementById('mb-f').style.width = pct('f') + '%';

    const rule = document.getElementById('macro-rule');
    rule.classList.remove('warn');
    if (macroMode === 'auto') {
        rule.textContent = t('set.macroRule', { g: MACRO_RULES.proteinPerKg, w: round(weight, 1) });
    } else {
        // Custom: show how the typed macros add up against the calorie target.
        const diff = round(sum - p.daily_calorie_target);
        rule.textContent = t('set.macroSum', { sum: round(sum), target: p.daily_calorie_target }) + ' ' +
            (Math.abs(diff) <= 25 ? t('set.macroMatch') : t(diff > 0 ? 'set.macroOver' : 'set.macroUnder', { n: Math.abs(diff) }));
        rule.classList.toggle('warn', Math.abs(diff) > 25);
    }
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

// ---- Save ---------------------------------------------------
async function save(e) {
    e.preventDefault();
    document.activeElement?.blur();
    const payload = formProfile();
    if (!payload.goal_date) payload.goal_date = null;
    const weightChanged = Number(payload.current_weight) !== Number(JSON.parse(savedSnapshot).current_weight);

    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    try {
        const { error } = await db.from('profile').update(payload).eq('id', 1);
        if (error) throw error;

        // A new current weight is today's weigh-in, so Home, the Tracker and the charts agree.
        if (weightChanged && payload.current_weight > 0) {
            const { error: wErr } = await db.from('weight_log').upsert(
                { log_date: todayISO(), weight: payload.current_weight }, { onConflict: 'log_date' });
            if (wErr) throw wErr;
        }

        setMacroMode(macroMode);
        setKcalMode(kcalMode);
        clearProfileCache();
        savedSnapshot = snapshot();
        savedMode = macroMode;
        savedKcalMode = kcalMode;
        showToast(t('set.saved'), 'success');
    } catch (err) {
        showToast(t('common.errorSaving', { msg: err.message }), 'error');
    } finally {
        updateDirty();
    }
}
