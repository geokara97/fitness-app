// ============================================================
// Exercises & splits — shared by the workout log, the exercise
// library and the exercise hub page.
// ============================================================

function splitLabel(s) {
    return (LANG === 'el' && s.split_name_el) ? s.split_name_el : s.split_name;
}

function exerciseLabel(e) {
    return (LANG === 'el' && e.exercise_name_el) ? e.exercise_name_el : e.exercise_name;
}

async function fetchSplits() {
    const { data, error } = await db.from('splits').select('*')
        .order('sort_order').order('split_name');
    if (error) throw error;
    return data || [];
}

// Exercises with .splitIds; hidden (is_active = false) ones only when asked.
async function fetchExercises({ includeHidden = false } = {}) {
    let query = db.from('exercises').select('*, exercise_splits(split_id)').order('exercise_name');
    if (!includeHidden) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(e => ({ ...e, splitIds: (e.exercise_splits || []).map(x => x.split_id) }));
}

// Checkbox list of splits (name="<name>"), ticking the ids in `checked`.
function splitChecksHtml(splits, checked, name) {
    return splits.map(s => `
        <label><input type="checkbox" name="${name}" value="${s.split_id}" ${checked.has(s.split_id) ? 'checked' : ''}>
        <span>${escapeHtml(splitLabel(s))}</span></label>`).join('');
}

function checkedSplitIds(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(c => Number(c.value));
}

async function replaceExerciseSplits(exerciseId, splitIds) {
    const { error: dErr } = await db.from('exercise_splits').delete().eq('exercise_id', exerciseId);
    if (dErr) throw dErr;
    if (!splitIds.length) return;
    const { error } = await db.from('exercise_splits')
        .insert(splitIds.map(split_id => ({ exercise_id: exerciseId, split_id })));
    if (error) throw error;
}

// Timed exercises (plank, wall sit…) are logged in seconds instead of reps.
function isTimedExercise(ex) { return !!ex && ex.measure === 'time'; }

// "90", "90s" or "1:30" -> 90 seconds; null when empty or invalid.
function parseDuration(value) {
    const v = String(value ?? '').trim().replace(/\s*s(ec)?$/i, '');
    if (!v) return null;
    const m = v.match(/^(\d+):([0-5]?\d)$/);
    const secs = m ? Number(m[1]) * 60 + Number(m[2]) : Number(v.replace(',', '.'));
    return Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null;
}

// 45 -> "45 s", 90 -> "1:30"
function formatDuration(secs) {
    secs = Math.round(Number(secs) || 0);
    return secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// Insert a user exercise and link it to its splits. Rolls back on failure.
async function createExercise({ nameEn, nameEl, splitIds, measure = 'reps' }) {
    const { data: ex, error } = await db.from('exercises')
        .insert([{ exercise_name: nameEn, exercise_name_el: nameEl || null, is_custom: true, measure }])
        .select().single();
    if (error) throw error;
    try {
        await replaceExerciseSplits(ex.exercise_id, splitIds);
    } catch (err) {
        await db.from('exercises').delete().eq('exercise_id', ex.exercise_id);
        throw err;
    }
    return { ...ex, splitIds };
}

async function updateExercise(exerciseId, { nameEn, nameEl, splitIds, measure = 'reps' }) {
    const { data: ex, error } = await db.from('exercises')
        .update({ exercise_name: nameEn, exercise_name_el: nameEl || null, measure })
        .eq('exercise_id', exerciseId)
        .select().single();
    if (error) throw error;
    await replaceExerciseSplits(exerciseId, splitIds);
    return { ...ex, splitIds };
}

// Friendly message for exercise save errors.
function exerciseErrorMessage(err) {
    if (err.code === '23505') return t('wo.nxDuplicate');
    if (/measure|duration_seconds/.test(err.message || '')) return t('wo.timedDbMissing');   // exercises_schema.sql not re-run
    return t('common.errorSaving', { msg: err.message });
}
