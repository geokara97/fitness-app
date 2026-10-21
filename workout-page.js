// ============================================================
// Workout Session page — live timer drives calories burned
// ============================================================

let profile = null;
let exercises = [];          // each with .splitIds (from exercise_splits)
let splits = [];
const selectedSplits = new Set();   // split_ids chosen for this session
let exerciseCount = 0;

// ---- Timer state --------------------------------------------
const timer = {
    state: 'idle',          // idle | running | paused
    accumulatedMs: 0,       // time banked from previous run segments
    segmentStart: 0,        // performance.now() when current segment began
    tickHandle: null,
};

function elapsedSeconds() {
    let ms = timer.accumulatedMs;
    if (timer.state === 'running') ms += performance.now() - timer.segmentStart;
    return ms / 1000;
}

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('workout');
    try {
        profile = await loadProfile();
    } catch (e) { return; }

    document.getElementById('w-date').value = todayISO();

    // Prefill bodyweight with the most recent weigh-in.
    const { data: w } = await db.from('weight_log')
        .select('weight').order('log_date', { ascending: false }).limit(1);
    const bw = (w && w.length) ? Number(w[0].weight) : Number(profile.current_weight);
    document.getElementById('w-bodyweight').value = bw;

    await loadSplits();
    await loadExercises();
    addExerciseBlock();

    document.getElementById('btn-start').addEventListener('click', startTimer);
    document.getElementById('btn-pause').addEventListener('click', pauseTimer);
    document.getElementById('btn-reset').addEventListener('click', resetTimer);
    document.getElementById('btn-add-exercise').addEventListener('click', addExerciseBlock);
    document.getElementById('btn-save').addEventListener('click', saveWorkout);
    document.getElementById('w-splits').addEventListener('click', onSplitChipClick);
    initNewExerciseModal();
    document.getElementById('w-bodyweight').addEventListener('input', updateTimerUI);

    updateTimerUI();
});

// ---- Data ---------------------------------------------------
function splitLabel(s) {
    return (LANG === 'el' && s.split_name_el) ? s.split_name_el : s.split_name;
}

function exerciseLabel(e) {
    return (LANG === 'el' && e.exercise_name_el) ? e.exercise_name_el : e.exercise_name;
}

async function loadSplits() {
    const { data, error } = await db.from('splits').select('*')
        .order('sort_order').order('split_name');
    if (error) { showToast(t('wo.dbUpgrade'), 'error'); return; }
    splits = data || [];
    renderSplitChips();
}

async function loadExercises() {
    const { data, error } = await db.from('exercises')
        .select('*, exercise_splits(split_id)')
        .eq('is_active', true)
        .order('exercise_name');
    if (error) { showToast(t('wo.dbUpgrade'), 'error'); return; }
    exercises = (data || []).map(e => ({ ...e, splitIds: (e.exercise_splits || []).map(x => x.split_id) }));
}

// ---- Splits (multi-select) ----------------------------------
function renderSplitChips() {
    document.getElementById('w-splits').innerHTML = splits.map(s => `
        <button type="button" class="chip ${selectedSplits.has(s.split_id) ? 'active' : ''}"
                data-split="${s.split_id}" aria-pressed="${selectedSplits.has(s.split_id)}">
            ${escapeHtml(splitLabel(s))}
        </button>`).join('');
    const hint = document.getElementById('w-splits-hint');
    hint.textContent = selectedSplits.size
        ? t('wo.splitsShowing', { n: filteredExercises().length })
        : t('wo.splitsHint');
}

function onSplitChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const id = Number(chip.dataset.split);
    if (selectedSplits.has(id)) selectedSplits.delete(id); else selectedSplits.add(id);
    renderSplitChips();
    refreshExerciseSelects();
}

// Exercises in any selected split (all exercises when none is selected).
function filteredExercises() {
    if (!selectedSplits.size) return exercises;
    return exercises.filter(e => e.splitIds.some(id => selectedSplits.has(id)));
}

// <option>s grouped by split; each exercise listed once, under its first matching split.
function exerciseOptionsHtml(selectedValue) {
    const list = filteredExercises();
    const groups = selectedSplits.size ? splits.filter(s => selectedSplits.has(s.split_id)) : splits;
    const placed = new Set();
    const byLabel = (a, b) => exerciseLabel(a).localeCompare(exerciseLabel(b), LOCALE);
    const opt = e => `<option value="${e.exercise_id}" ${String(e.exercise_id) === String(selectedValue) ? 'selected' : ''}>${escapeHtml(exerciseLabel(e))}</option>`;

    let html = `<option value="">${t('wo.selectExercise')}</option>`;
    groups.forEach(s => {
        const inGroup = list.filter(e => !placed.has(e.exercise_id) && e.splitIds.includes(s.split_id)).sort(byLabel);
        if (!inGroup.length) return;
        inGroup.forEach(e => placed.add(e.exercise_id));
        html += `<optgroup label="${escapeHtml(splitLabel(s))}">${inGroup.map(opt).join('')}</optgroup>`;
    });
    const rest = list.filter(e => !placed.has(e.exercise_id)).sort(byLabel);
    if (rest.length) html += `<optgroup label="${escapeHtml(t('wo.otherExercises'))}">${rest.map(opt).join('')}</optgroup>`;

    // Keep an already-chosen exercise even if its split was just deselected.
    if (selectedValue && !list.some(e => String(e.exercise_id) === String(selectedValue))) {
        const kept = exercises.find(e => String(e.exercise_id) === String(selectedValue));
        if (kept) html += `<optgroup label="${escapeHtml(t('wo.alreadyChosen'))}">${opt(kept)}</optgroup>`;
    }
    return html;
}

function refreshExerciseSelects() {
    document.querySelectorAll('.ex-select').forEach(sel => {
        sel.innerHTML = exerciseOptionsHtml(sel.value);
    });
}

// ---- Timer --------------------------------------------------
function startTimer() {
    if (timer.state === 'running') return;
    timer.segmentStart = performance.now();
    timer.state = 'running';
    timer.tickHandle = setInterval(updateTimerUI, 250);
    updateTimerUI();
}

function pauseTimer() {
    if (timer.state !== 'running') return;
    timer.accumulatedMs += performance.now() - timer.segmentStart;
    timer.state = 'paused';
    clearInterval(timer.tickHandle);
    updateTimerUI();
}

function resetTimer() {
    if (timer.state !== 'idle' && !confirm(t('wo.confirmReset'))) return;
    clearInterval(timer.tickHandle);
    timer.state = 'idle';
    timer.accumulatedMs = 0;
    timer.segmentStart = 0;
    updateTimerUI();
}

function liveBurn() {
    const bw = Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
    return calcWorkoutBurn(bw, elapsedSeconds() / 60, profile);
}

function updateTimerUI() {
    const secs = elapsedSeconds();
    document.getElementById('timer-display').textContent = formatClock(secs);
    document.getElementById('timer-burn').textContent = t('wo.burn', { n: round(liveBurn()) });

    const bw = Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
    document.getElementById('timer-sub').textContent =
        t('wo.sub', { bw, rate: profile.lifting_kcal_per_kg_min });

    const stateEl = document.getElementById('timer-state');
    stateEl.className = 'timer-state ' + timer.state;
    stateEl.textContent = t('wo.state.' + timer.state);

    const start = document.getElementById('btn-start');
    const pause = document.getElementById('btn-pause');
    const reset = document.getElementById('btn-reset');
    start.disabled = timer.state === 'running';
    start.textContent = timer.state === 'paused' ? t('wo.resume') : t('wo.start');
    pause.disabled = timer.state !== 'running';
    reset.disabled = timer.state === 'idle' && timer.accumulatedMs === 0;
}

// ---- Exercise blocks ----------------------------------------
function addExerciseBlock(selectedId) {
    exerciseCount++;
    const id = exerciseCount;
    const opts = exerciseOptionsHtml(typeof selectedId === 'number' ? selectedId : '');

    const block = document.createElement('div');
    block.className = 'exercise-block';
    block.id = `ex-${id}`;
    block.innerHTML = `
        <div class="exercise-block-head">
            <strong>${t('wo.exerciseN', { n: id })}</strong>
            <button type="button" class="icon-btn" onclick="removeExerciseBlock(${id})">×</button>
        </div>
        <div class="form-group">
            <select class="ex-select">${opts}</select>
        </div>
        <div class="sets" id="sets-${id}"></div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="addSet(${id})">${t('wo.addSet')}</button>
    `;
    document.getElementById('exercises').appendChild(block);
    addSet(id);
}

function removeExerciseBlock(id) {
    const el = document.getElementById(`ex-${id}`);
    if (el) el.remove();
}

function addSet(blockId) {
    const wrap = document.getElementById(`sets-${blockId}`);
    const setNo = wrap.children.length + 1;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `
        <span class="set-tag">${t('wo.setN', { n: setNo })}</span>
        <input type="number" class="set-reps" min="1" placeholder="${t('wo.repsPh')}">
        <input type="number" class="set-weight" step="0.5" placeholder="kg">
        <button type="button" class="icon-btn" onclick="this.closest('.set-row').remove()">×</button>
    `;
    wrap.appendChild(row);
}

// ---- Save ---------------------------------------------------
async function saveWorkout() {
    const secs = Math.round(elapsedSeconds());
    if (secs < 5) {
        if (!confirm(t('wo.confirmZero'))) return;
    }

    const date = document.getElementById('w-date').value;
    if (!date) { showToast(t('wo.pickDate'), 'error'); return; }

    const bodyweight = Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
    const notes = document.getElementById('w-notes').value || null;
    const calories = round(calcWorkoutBurn(bodyweight, secs / 60, profile), 1);

    // Collect exercises + sets.
    const exerciseRows = [];
    let order = 0;
    document.querySelectorAll('.exercise-block').forEach(block => {
        const exId = block.querySelector('.ex-select').value;
        if (!exId) return;
        order++;
        let setNo = 0;
        block.querySelectorAll('.set-row').forEach(row => {
            const reps = row.querySelector('.set-reps').value;
            const weight = row.querySelector('.set-weight').value;
            if (!reps && !weight) return;
            setNo++;
            exerciseRows.push({
                exercise_id: Number(exId),
                exercise_order: order,
                set_number: setNo,
                reps: reps ? Number(reps) : null,
                weight: weight ? Number(weight) : null,
            });
        });
    });

    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    let workoutId = null;
    try {
        const { data: workout, error: wErr } = await db.from('workouts').insert([{
            workout_date: date,
            duration_seconds: secs,
            bodyweight: bodyweight,
            calories_burned: calories,
            notes: notes,
        }]).select().single();
        if (wErr) throw wErr;
        workoutId = workout.workout_id;

        if (selectedSplits.size) {
            const { error: sErr } = await db.from('workout_splits')
                .insert([...selectedSplits].map(split_id => ({ workout_id: workoutId, split_id })));
            if (sErr) throw sErr;
        }

        if (exerciseRows.length) {
            const rows = exerciseRows.map(r => ({ ...r, workout_id: workoutId }));
            const { error: eErr } = await db.from('workout_exercises').insert(rows);
            if (eErr) throw eErr;
        }

        showToast(t('wo.saved', { kcal: round(calories), date: formatDate(date) }));
        setTimeout(() => { window.location.href = 'history.html'; }, 1400);
    } catch (err) {
        // Don't leave a half-saved workout behind (splits & sets cascade).
        if (workoutId) await db.from('workouts').delete().eq('workout_id', workoutId);
        showToast(t('wo.errorSaving', { msg: err.message }), 'error');
        btn.disabled = false;
    }
}

// ---- New exercise -------------------------------------------
function initNewExerciseModal() {
    const modal = document.getElementById('exercise-modal');
    const close = () => modal.classList.remove('show');
    document.getElementById('btn-new-exercise').addEventListener('click', openNewExerciseModal);
    document.getElementById('exercise-modal-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.getElementById('exercise-form').addEventListener('submit', saveNewExercise);
}

function openNewExerciseModal() {
    document.getElementById('exercise-form').reset();
    // Pre-tick the splits chosen for this session.
    document.getElementById('nx-splits').innerHTML = splits.map(s => `
        <label><input type="checkbox" name="nx-split" value="${s.split_id}" ${selectedSplits.has(s.split_id) ? 'checked' : ''}>
        <span>${escapeHtml(splitLabel(s))}</span></label>`).join('');
    document.getElementById('exercise-modal').classList.add('show');
    document.getElementById('nx-name-en').focus();
}

async function saveNewExercise(e) {
    e.preventDefault();
    const nameEn = document.getElementById('nx-name-en').value.trim();
    const nameEl = document.getElementById('nx-name-el').value.trim() || null;
    const splitIds = [...document.querySelectorAll('input[name="nx-split"]:checked')].map(c => Number(c.value));
    if (!nameEn) return;
    if (!splitIds.length) { showToast(t('wo.nxNeedSplit'), 'error'); return; }

    const btn = document.getElementById('nx-save');
    btn.disabled = true;
    let newId = null;
    try {
        const { data: ex, error } = await db.from('exercises')
            .insert([{ exercise_name: nameEn, exercise_name_el: nameEl, is_custom: true }])
            .select().single();
        if (error) throw error;
        newId = ex.exercise_id;

        const { error: lErr } = await db.from('exercise_splits')
            .insert(splitIds.map(split_id => ({ exercise_id: newId, split_id })));
        if (lErr) throw lErr;

        exercises.push({ ...ex, splitIds });
        // Make sure the new exercise is visible with the current filter.
        if (selectedSplits.size && !splitIds.some(id => selectedSplits.has(id))) {
            splitIds.forEach(id => selectedSplits.add(id));
        }
        renderSplitChips();
        refreshExerciseSelects();

        // Drop it into the first empty exercise block, or a new one.
        const empty = [...document.querySelectorAll('.ex-select')].find(s => !s.value);
        if (empty) empty.value = String(newId); else addExerciseBlock(newId);

        document.getElementById('exercise-modal').classList.remove('show');
        showToast(t('wo.nxAdded', { name: exerciseLabel(ex) }));
    } catch (err) {
        if (newId) await db.from('exercises').delete().eq('exercise_id', newId);
        showToast(err.code === '23505' ? t('wo.nxDuplicate') : t('common.errorSaving', { msg: err.message }), 'error');
    } finally {
        btn.disabled = false;
    }
}
