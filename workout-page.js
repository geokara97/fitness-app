// ============================================================
// Workout log page — timer, splits, sets and session summary.
// Timer state and the form draft live in localStorage
// (workout-session.js), so a session keeps counting while you are
// on other pages or the browser is closed, and the form comes back.
// ============================================================

let profile = null;
let exercises = [];          // each with .splitIds (from exercise_splits)
let splits = [];
const selectedSplits = new Set();   // split_ids chosen for this session
let exerciseCount = 0;
let draftTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('exercise');
    try {
        profile = await loadProfile();
    } catch (e) { return; }

    await loadSplits();
    await loadExercises();
    await restoreOrInitForm();

    document.getElementById('btn-start').addEventListener('click', startTimer);
    document.getElementById('btn-pause').addEventListener('click', () => { sessionPause(); updateTimerUI(); });
    document.getElementById('btn-stop').addEventListener('click', stopTimer);
    document.getElementById('btn-reset').addEventListener('click', resetTimer);
    document.getElementById('btn-add-exercise').addEventListener('click', () => { addExerciseBlock(); saveDraft(); });
    document.getElementById('btn-save').addEventListener('click', saveWorkout);
    document.getElementById('btn-discard').addEventListener('click', discardWorkout);
    document.getElementById('w-splits').addEventListener('click', onSplitChipClick);
    document.getElementById('w-calories').addEventListener('input', onCaloriesInput);
    document.getElementById('w-calories').addEventListener('blur', updateTimerUI);
    document.getElementById('btn-cal-auto').addEventListener('click', () => {
        updateSession({ manualCalories: null });
        updateTimerUI();
    });
    // Any edit in the form is saved to the draft (debounced).
    document.querySelector('.container').addEventListener('input', e => {
        if (e.target.id !== 'w-calories') scheduleDraftSave();
    });
    initNewExerciseModal();

    onSessionChange(updateTimerUI);           // e.g. paused from the bar in another tab
    setInterval(updateTimerUI, 500);
    updateTimerUI();

    if (location.hash === '#report') showReport();
});

// ---- Data ---------------------------------------------------
async function loadSplits() {
    try { splits = await fetchSplits(); }
    catch (e) { showToast(t('wo.dbUpgrade'), 'error'); return; }
    renderSplitChips();
}

async function loadExercises() {
    try { exercises = await fetchExercises(); }
    catch (e) { showToast(t('wo.dbUpgrade'), 'error'); }
}

function currentBodyweight() {
    return Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
}

// ---- Draft (form state kept in the session) -----------------
function collectDraft() {
    return {
        date: document.getElementById('w-date').value,
        bodyweight: document.getElementById('w-bodyweight').value,
        splits: [...selectedSplits],
        notes: document.getElementById('w-notes').value,
        blocks: [...document.querySelectorAll('.exercise-block')].map(block => ({
            exerciseId: block.querySelector('.ex-select').value,
            sets: [...block.querySelectorAll('.set-row')].map(row => ({
                reps: row.querySelector('.set-reps').value,
                weight: row.querySelector('.set-weight').value,
            })),
        })),
    };
}

function draftHasContent(d) {
    return !!d && (d.notes || (d.splits && d.splits.length) ||
        (d.blocks || []).some(b => b.exerciseId || b.sets.some(s => s.reps || s.weight)));
}

function saveDraft() {
    clearTimeout(draftTimer);
    updateSession({
        draft: collectDraft(),
        bodyweight: currentBodyweight(),
        rate: Number(profile.lifting_kcal_per_kg_min),
    });
    updateTimerUI();
}

function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
}

async function restoreOrInitForm() {
    const s = readSession();
    const d = s && s.draft;

    if (d && (sessionIsActive(s) || draftHasContent(d))) {
        document.getElementById('w-date').value = d.date || todayISO();
        document.getElementById('w-bodyweight').value = d.bodyweight || '';
        document.getElementById('w-notes').value = d.notes || '';
        selectedSplits.clear();
        (d.splits || []).forEach(id => selectedSplits.add(Number(id)));
        renderSplitChips();
        (d.blocks && d.blocks.length ? d.blocks : [{ exerciseId: '', sets: [] }])
            .forEach(b => addExerciseBlock(b.exerciseId ? Number(b.exerciseId) : '', b.sets));
        if (!document.getElementById('w-bodyweight').value) await prefillBodyweight();
        showToast(t('wo.restored'));
    } else {
        document.getElementById('w-date').value = todayISO();
        await prefillBodyweight();
        addExerciseBlock();
    }

    // Keep the bar's calorie estimate in sync with this profile.
    if (s) updateSession({ bodyweight: currentBodyweight(), rate: Number(profile.lifting_kcal_per_kg_min) });
}

// Prefill bodyweight with the most recent weigh-in.
async function prefillBodyweight() {
    const { data: w } = await db.from('weight_log')
        .select('weight').order('log_date', { ascending: false }).limit(1);
    document.getElementById('w-bodyweight').value =
        (w && w.length) ? Number(w[0].weight) : Number(profile.current_weight);
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
    saveDraft();
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
    sessionStart({ bodyweight: currentBodyweight(), rate: Number(profile.lifting_kcal_per_kg_min) });
    saveDraft();
}

async function stopTimer() {
    const ok = await confirmToast(t('wo.confirmStop'), { okText: t('wo.stopYes'), cancelText: t('wo.stopNo') });
    if (!ok) return;
    sessionStop();
    updateTimerUI();
    showReport();
}

function resetTimer() {
    if (sessionElapsedMs(readSession()) > 0 && !confirm(t('wo.confirmReset'))) return;
    sessionResetTimer();
    updateTimerUI();
}

function showReport() {
    const card = document.getElementById('report');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 2000);
}

function countLoggedSets() {
    return [...document.querySelectorAll('.exercise-block')]
        .filter(b => b.querySelector('.ex-select').value)
        .reduce((n, b) => n + [...b.querySelectorAll('.set-row')]
            .filter(r => r.querySelector('.set-reps').value || r.querySelector('.set-weight').value).length, 0);
}

function updateTimerUI() {
    if (!profile) return;
    const s = readSession();
    const state = (s && s.state) || 'idle';
    const elapsed = sessionElapsedMs(s);
    const clock = formatClock(elapsed / 1000);
    const bw = currentBodyweight();
    const rate = Number(profile.lifting_kcal_per_kg_min);
    const auto = calcWorkoutBurn(bw, elapsed / 60000, profile);
    const manual = s && s.manualCalories != null ? Number(s.manualCalories) : null;

    document.getElementById('timer-display').textContent = clock;
    document.getElementById('timer-burn').textContent = manual != null
        ? t('wo.burnManual', { n: round(manual) })
        : t('wo.burn', { n: round(auto) });
    document.getElementById('timer-sub').textContent = t('wo.sub', { bw, rate });

    const stateEl = document.getElementById('timer-state');
    stateEl.className = 'timer-state ' + state;
    stateEl.textContent = t('wo.state.' + state);

    const start = document.getElementById('btn-start');
    start.disabled = state === 'running';
    start.textContent = (state === 'paused' || state === 'stopped') ? t('wo.resume') : t('wo.start');
    document.getElementById('btn-pause').disabled = state !== 'running';
    document.getElementById('btn-stop').disabled = !(state === 'running' || state === 'paused');
    document.getElementById('btn-reset').disabled = elapsed === 0;

    // Session summary
    document.getElementById('rep-duration').textContent = clock;
    document.getElementById('rep-sets').textContent = countLoggedSets();
    const calInput = document.getElementById('w-calories');
    if (document.activeElement !== calInput) calInput.value = round(manual != null ? manual : auto);
    document.getElementById('w-calories-hint').textContent = manual != null
        ? t('wo.calManualHint', { n: round(auto) })
        : t('wo.calAutoHint');
    document.getElementById('btn-cal-auto').hidden = manual == null;
}

// Typed calories (e.g. from a smartwatch) override the timer estimate.
function onCaloriesInput(e) {
    const v = e.target.value;
    updateSession({ manualCalories: v === '' ? null : Math.max(0, Number(v)) });
}

// ---- Exercise blocks ----------------------------------------
function addExerciseBlock(selectedId, sets) {
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
        <button type="button" class="btn btn-ghost btn-sm" onclick="addSet(${id}); saveDraft();">${t('wo.addSet')}</button>
    `;
    document.getElementById('exercises').appendChild(block);
    (Array.isArray(sets) && sets.length ? sets : [{}]).forEach(set => addSet(id, set));
}

function removeExerciseBlock(id) {
    const el = document.getElementById(`ex-${id}`);
    if (el) el.remove();
    saveDraft();
}

function addSet(blockId, values = {}) {
    const wrap = document.getElementById(`sets-${blockId}`);
    const setNo = wrap.children.length + 1;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `
        <span class="set-tag">${t('wo.setN', { n: setNo })}</span>
        <input type="number" class="set-reps" min="1" placeholder="${t('wo.repsPh')}" value="${escapeHtml(values.reps || '')}">
        <input type="number" class="set-weight" step="0.5" placeholder="kg" value="${escapeHtml(values.weight || '')}">
        <button type="button" class="icon-btn" onclick="this.closest('.set-row').remove(); saveDraft();">×</button>
    `;
    wrap.appendChild(row);
}

// ---- Save / discard -----------------------------------------
async function saveWorkout() {
    const s = readSession();
    const secs = Math.round(sessionElapsedMs(s) / 1000);
    const manual = s && s.manualCalories != null ? Number(s.manualCalories) : null;
    if (secs < 5 && manual == null) {
        if (!confirm(t('wo.confirmZero'))) return;
    }

    const date = document.getElementById('w-date').value;
    if (!date) { showToast(t('wo.pickDate'), 'error'); return; }

    const bodyweight = currentBodyweight();
    const notes = document.getElementById('w-notes').value || null;
    const calories = round(manual != null ? manual : calcWorkoutBurn(bodyweight, secs / 60, profile), 1);

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

        clearSession();   // session saved — stop the timer everywhere
        showToast(t('wo.saved', { kcal: round(calories), date: formatDate(date) }));
        setTimeout(() => { window.location.href = 'history.html'; }, 1400);
    } catch (err) {
        // Don't leave a half-saved workout behind (splits & sets cascade).
        if (workoutId) await db.from('workouts').delete().eq('workout_id', workoutId);
        showToast(t('wo.errorSaving', { msg: err.message }), 'error');
        btn.disabled = false;
    }
}

function discardWorkout() {
    if (!confirm(t('wo.confirmDiscard'))) return;
    clearSession();
    showToast(t('wo.discarded'));
    setTimeout(() => window.location.replace('workout.html'), 600);
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
    document.getElementById('nx-splits').innerHTML = splitChecksHtml(splits, selectedSplits, 'nx-split');
    document.getElementById('exercise-modal').classList.add('show');
    document.getElementById('nx-name-en').focus();
}

async function saveNewExercise(e) {
    e.preventDefault();
    e.stopPropagation();
    const nameEn = document.getElementById('nx-name-en').value.trim();
    const nameEl = document.getElementById('nx-name-el').value.trim() || null;
    const splitIds = checkedSplitIds('nx-split');
    if (!nameEn) return;
    if (!splitIds.length) { showToast(t('wo.nxNeedSplit'), 'error'); return; }

    const btn = document.getElementById('nx-save');
    btn.disabled = true;
    try {
        const ex = await createExercise({ nameEn, nameEl, splitIds });
        const newId = ex.exercise_id;
        exercises.push(ex);
        // Make sure the new exercise is visible with the current filter.
        if (selectedSplits.size && !splitIds.some(id => selectedSplits.has(id))) {
            splitIds.forEach(id => selectedSplits.add(id));
        }
        renderSplitChips();
        refreshExerciseSelects();

        // Drop it into the first empty exercise block, or a new one.
        const empty = [...document.querySelectorAll('.ex-select')].find(s => !s.value);
        if (empty) empty.value = String(newId); else addExerciseBlock(newId);
        saveDraft();

        document.getElementById('exercise-modal').classList.remove('show');
        showToast(t('wo.nxAdded', { name: exerciseLabel(ex) }));
    } catch (err) {
        showToast(exerciseErrorMessage(err), 'error');
    } finally {
        btn.disabled = false;
    }
}
