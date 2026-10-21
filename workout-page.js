// ============================================================
// Workout Session page — live timer drives calories burned
// ============================================================

let profile = null;
let exercises = [];
let splits = [];
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
    document.getElementById('w-bodyweight').addEventListener('input', updateTimerUI);

    updateTimerUI();
});

// ---- Data ---------------------------------------------------
async function loadSplits() {
    const { data } = await db.from('splits').select('*').order('split_name');
    splits = data || [];
    document.getElementById('w-split').innerHTML =
        '<option value="">— Select split —</option>' +
        splits.map(s => `<option value="${s.split_id}">${s.split_name}</option>`).join('');
}

async function loadExercises() {
    const { data } = await db.from('exercises')
        .select('*, splits(split_name)')
        .eq('is_active', true)
        .order('exercise_name');
    exercises = data || [];
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
    if (timer.state !== 'idle' && !confirm('Reset the timer to 00:00?')) return;
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
    document.getElementById('timer-burn').textContent = `🔥 ${round(liveBurn())} kcal burned`;

    const bw = Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
    document.getElementById('timer-sub').textContent =
        `Bodyweight ${bw} kg · rate ${profile.lifting_kcal_per_kg_min} kcal/kg/min`;

    const stateEl = document.getElementById('timer-state');
    stateEl.className = 'timer-state ' + timer.state;
    stateEl.textContent = { idle: 'Ready', running: 'Training', paused: 'Paused' }[timer.state];

    const start = document.getElementById('btn-start');
    const pause = document.getElementById('btn-pause');
    const reset = document.getElementById('btn-reset');
    start.disabled = timer.state === 'running';
    start.textContent = timer.state === 'paused' ? '▶ Resume' : '▶ Start';
    pause.disabled = timer.state !== 'running';
    reset.disabled = timer.state === 'idle' && timer.accumulatedMs === 0;
}

// ---- Exercise blocks ----------------------------------------
function addExerciseBlock() {
    exerciseCount++;
    const id = exerciseCount;
    const opts = exercises.map(e =>
        `<option value="${e.exercise_id}">${e.exercise_name}${e.splits ? ' — ' + e.splits.split_name : ''}</option>`
    ).join('');

    const block = document.createElement('div');
    block.className = 'exercise-block';
    block.id = `ex-${id}`;
    block.innerHTML = `
        <div class="exercise-block-head">
            <strong>Exercise ${id}</strong>
            <button type="button" class="icon-btn" onclick="removeExerciseBlock(${id})">×</button>
        </div>
        <div class="form-group">
            <select class="ex-select"><option value="">— Select exercise —</option>${opts}</select>
        </div>
        <div class="sets" id="sets-${id}"></div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="addSet(${id})">+ Add Set</button>
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
        <span class="set-tag">Set ${setNo}</span>
        <input type="number" class="set-reps" min="1" placeholder="reps">
        <input type="number" class="set-weight" step="0.5" placeholder="kg">
        <button type="button" class="icon-btn" onclick="this.closest('.set-row').remove()">×</button>
    `;
    wrap.appendChild(row);
}

// ---- Save ---------------------------------------------------
async function saveWorkout() {
    const secs = Math.round(elapsedSeconds());
    if (secs < 5) {
        if (!confirm('The timer is at 00:00. Save this workout with no timed duration (0 kcal burn)?')) return;
    }

    const date = document.getElementById('w-date').value;
    if (!date) { showToast('Please pick a date', 'error'); return; }

    const bodyweight = Number(document.getElementById('w-bodyweight').value) || Number(profile.current_weight);
    const splitId = document.getElementById('w-split').value || null;
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
    try {
        const { data: workout, error: wErr } = await db.from('workouts').insert([{
            workout_date: date,
            split_id: splitId,
            duration_seconds: secs,
            bodyweight: bodyweight,
            calories_burned: calories,
            notes: notes,
        }]).select().single();
        if (wErr) throw wErr;

        if (exerciseRows.length) {
            const rows = exerciseRows.map(r => ({ ...r, workout_id: workout.workout_id }));
            const { error: eErr } = await db.from('workout_exercises').insert(rows);
            if (eErr) throw eErr;
        }

        showToast(`Workout saved — ${round(calories)} kcal added to ${formatDate(date)}`);
        setTimeout(() => { window.location.href = 'history.html'; }, 1400);
    } catch (err) {
        showToast('Error saving workout: ' + err.message, 'error');
        btn.disabled = false;
    }
}
