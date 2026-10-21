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

    const langSelect = document.getElementById('s-lang');
    langSelect.value = LANG;
    langSelect.addEventListener('change', () => setLang(langSelect.value));

    try {
        profile = await loadProfile();
    } catch (e) { return; }

    for (const [elId, col] of Object.entries(FIELDS)) {
        const el = document.getElementById(elId);
        el.value = profile[col] ?? '';
        el.addEventListener('input', recompute);
        el.addEventListener('change', recompute);
    }
    recompute();
    document.getElementById('settings-form').addEventListener('submit', save);
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
    const bmr = calcBMR(w, p);
    const resting = calcRestingBurn(w, p);
    const stepsBurn = calcStepsBurn(10000, w, p);
    const liftBurn = calcWorkoutBurn(w, p.lifting_default_min, p);

    document.getElementById('c-bmr').textContent = round(bmr);
    document.getElementById('c-resting').textContent = round(resting);
    document.getElementById('c-train').textContent = round(resting + stepsBurn + liftBurn);
    document.getElementById('c-rest').textContent = round(resting + stepsBurn);
}

async function save(e) {
    e.preventDefault();
    const payload = formProfile();
    if (!payload.goal_date) payload.goal_date = null;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const { error } = await db.from('profile').update(payload).eq('id', 1);
        if (error) throw error;
        clearProfileCache();
        showToast(t('set.saved'));
    } catch (err) {
        showToast(t('common.errorSaving', { msg: err.message }), 'error');
    } finally {
        btn.disabled = false;
    }
}
