// ============================================================
// Daily Tracker page
// ============================================================

let profile = null;
let weightChart = null;
let netChart = null;
let activeChart = 'weight';
let dayHasEntry = false;
let loadedEaten = '';          // "Calories eaten" as loaded, to tell user edits from stale values

// Everyday goals for the progress bars on the metric tiles
const GOALS = { steps: 10000, sleep: 8, water: 3 };
const RING_LENGTH = 2 * Math.PI * 52;      // circumference of the energy ring (r = 52)

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('tracker');
    try {
        profile = await loadProfile();
    } catch (e) { return; }

    const dateInput = document.getElementById('f-date');
    dateInput.value = todayISO();
    dateInput.max = todayISO();
    dateInput.addEventListener('change', async () => {
        if (!(await confirmLeaveEdits())) { dateInput.value = shownDate; return; }
        loadDay();
    });

    document.getElementById('day-prev').addEventListener('click', () => stepDay(-1));
    document.getElementById('day-next').addEventListener('click', () => stepDay(1));
    if (typeof attachSwipe === 'function') {
        attachSwipe(document.getElementById('energy-card'), { onLeft: () => stepDay(1), onRight: () => stepDay(-1) });
    }

    // Entries are read-only until Edit; Save Day commits them, Cancel puts them back.
    const form = document.getElementById('log-form');
    form.addEventListener('submit', e => { e.preventDefault(); saveEdits(); });
    form.querySelectorAll('input, textarea').forEach(el =>
        el.addEventListener('input', () => { updateTiles(); updateEditState(); }));
    // Tapping a tile while viewing starts editing that field.
    form.addEventListener('click', e => {
        if (editMode || e.target.closest('.edit-bar')) return;
        const tile = e.target.closest('.metric');
        if (!tile) return;
        e.preventDefault();
        setEditMode(true, tile.querySelector('input, textarea'));
    });
    form.querySelectorAll('[data-water]').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault();
        if (!editMode) return;
        const input = document.getElementById('f-water');
        input.value = round((parseDecimal(input.value) || 0) + Number(btn.dataset.water), 2);
        updateTiles();
        updateEditState();
    }));
    document.getElementById('btn-edit').addEventListener('click', () => setEditMode(true));
    document.getElementById('btn-cancel').addEventListener('click', cancelEdits);
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    setEditMode(false);

    // Back on this page (back button, another tab, app switch): meals may have been
    // marked as eaten meanwhile, so reload the day unless it is being edited.
    const refreshIfIdle = async () => {
        if (editMode) return;
        await loadDay();
        await refreshHistory();
    };
    window.addEventListener('pageshow', e => { if (e.persisted) refreshIfIdle(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshIfIdle(); });

    document.querySelectorAll('.chart-tabs .main-tab').forEach(tab =>
        tab.addEventListener('click', () => showChart(tab.dataset.chart)));
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.querySelector('.chart-tabs'), '.main-tab');

    await loadDay();
    await Promise.all([refreshCharts(), refreshHistory()]);
});

// ---- Day switching ------------------------------------------
function addDaysISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function stepDay(delta) {
    const input = document.getElementById('f-date');
    const next = addDaysISO(input.value, delta);
    if (next > todayISO()) return;
    if (!(await confirmLeaveEdits())) return;
    input.value = next;
    await loadDay();
    if (typeof springIn === 'function') {
        springIn(document.getElementById('energy-card'), delta);
        springIn(document.getElementById('log-form'), delta);
    }
}

function renderDayHeader(date) {
    document.getElementById('day-title').textContent = formatDate(date);
    document.getElementById('day-sub').textContent =
        new Date(date + 'T00:00:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('day-next').disabled = date >= todayISO();
}

// ---- Burn helpers -------------------------------------------
async function workoutBurnFor(date) {
    const { data } = await db.from('workouts').select('calories_burned').eq('workout_date', date);
    return (data || []).reduce((s, w) => s + Number(w.calories_burned || 0), 0);
}

// Weight in effect on a given date (latest log on/before it).
function buildWeightLookup(weightRows) {
    return (date) => {
        let w = Number(profile.current_weight);
        for (const r of weightRows) { if (r.log_date <= date) w = Number(r.weight); }
        return w;
    };
}

// ---- Load a day into the tiles ------------------------------
async function loadDay() {
    const date = document.getElementById('f-date').value;
    if (!date) return;
    renderDayHeader(date);
    shownDate = date;

    const [dailyRes, weightRes] = await Promise.all([
        db.from('daily_log').select('*').eq('log_date', date).maybeSingle(),
        db.from('weight_log').select('weight').eq('log_date', date).maybeSingle(),
    ]);
    const d = dailyRes.data || {};
    dayHasEntry = !!dailyRes.data;
    loadedEaten = d.calories_eaten == null ? '' : String(d.calories_eaten);
    document.getElementById('f-weight').value = weightRes.data ? weightRes.data.weight : '';
    document.getElementById('f-eaten').value = d.calories_eaten ?? '';
    document.getElementById('f-steps').value = d.steps ?? '';
    document.getElementById('f-sleep').value = d.sleep_hours ?? '';
    document.getElementById('f-water').value = d.water_liters ?? '';
    document.getElementById('f-notes').value = d.notes ?? '';

    updateTiles();
    await refreshBreakdown(date);
}

// Goal bars and sub-lines on the metric tiles, updated as you type.
function updateTiles() {
    document.querySelectorAll('.m-value input').forEach(input => {
        const chars = Math.max(String(input.value).length, input.placeholder.length, 3);   // room to tap even when empty
        input.style.width = (chars + 0.6) + 'ch';
    });
    const num = id => parseDecimal(document.getElementById(id).value) || 0;
    const bar = (id, value, goal) => {
        document.getElementById(id).style.transform = `scaleX(${Math.min(1, value / goal)})`;
    };
    const steps = num('f-steps'), sleep = num('f-sleep'), water = num('f-water');
    bar('steps-bar', steps, GOALS.steps);
    bar('sleep-bar', sleep, GOALS.sleep);
    bar('water-bar', water, GOALS.water);
    document.getElementById('steps-sub').textContent = t('trk.goalOf', { n: GOALS.steps.toLocaleString(LOCALE) });
    document.getElementById('sleep-sub').textContent = t('trk.goalOf', { n: GOALS.sleep + ' h' });
    // Weight: progress from the start weight to the goal weight (both set in Settings).
    const start = Number(profile.start_weight), goal = Number(profile.goal_weight);
    const weightNow = num('f-weight') || Number(profile.current_weight);
    const done = start > goal ? (start - weightNow) / (start - goal) : 0;
    document.getElementById('weight-bar').style.transform = `scaleX(${Math.min(1, Math.max(0, done))})`;
    document.getElementById('weight-sub').textContent = `${start} → ${goal} kg · ` + (weightNow <= goal
        ? t('set.goalReached')
        : t('set.toGo', { n: round(weightNow - goal, 1) }));
}

// ---- Edit / Save --------------------------------------------
const EDIT_IDS = ['f-eaten', 'f-weight', 'f-steps', 'f-sleep', 'f-water', 'f-notes'];
let editMode = false;
let editSnapshot = null;       // field values when Edit was pressed
let shownDate = '';            // the day currently on screen

function formValues() {
    return Object.fromEntries(EDIT_IDS.map(id => [id, document.getElementById(id).value]));
}

function isDirty() {
    return editMode && JSON.stringify(formValues()) !== JSON.stringify(editSnapshot);
}

function setEditMode(on, focusEl = null) {
    editMode = on;
    document.getElementById('log-form').classList.toggle('editing', on);
    EDIT_IDS.forEach(id => { document.getElementById(id).readOnly = !on; });
    document.getElementById('btn-edit').hidden = on;
    document.getElementById('edit-bar').hidden = !on;
    if (on) {
        editSnapshot = formValues();
        // Focus only now that the field is editable: a field that took focus while
        // read-only would not bring up the phone keyboard, so re-focus it if needed.
        const el = focusEl || document.getElementById('f-eaten');
        if (document.activeElement === el) el.blur();
        el.focus();
    }
    updateEditState();
}

// Save Day is enabled once something changed.
function updateEditState() {
    document.getElementById('btn-save').disabled = !isDirty();
}

function cancelEdits() {
    for (const [id, value] of Object.entries(editSnapshot || {})) document.getElementById(id).value = value;
    updateTiles();
    setEditMode(false);
}

async function saveEdits() {
    if (!isDirty()) { setEditMode(false); return; }
    document.activeElement?.blur();
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    if (await saveDay()) {
        setEditMode(false);
        showToast(t('trk.saved'), 'success');
    } else {
        updateEditState();
    }
}

// Leaving the day with unsaved changes: ask first. Resolves true to go ahead.
async function confirmLeaveEdits() {
    if (!isDirty()) { if (editMode) setEditMode(false); return true; }
    const ok = await confirmToast(t('trk.discardEdits'), { okText: t('trk.discard'), cancelText: t('trk.keepEditing') });
    if (ok) setEditMode(false);
    return ok;
}

// Returns true when everything was saved.
async function saveDay() {
    const date = document.getElementById('f-date').value;
    if (!date) return;

    const val = (id) => {
        const v = document.getElementById(id).value;
        return parseDecimal(v);
    };
    const weight = val('f-weight');
    const notes = document.getElementById('f-notes').value || null;
    const row = {
        log_date: date,
        calories_eaten: val('f-eaten'),
        steps: val('f-steps'),
        sleep_hours: val('f-sleep'),
        water_liters: val('f-water'),
        notes: notes,
    };
    const empty = Object.entries(row).every(([k, v]) => k === 'log_date' || v === null);

    // "Calories eaten" is also changed by marking meals as eaten in Nutrition.
    // Only write it when it was edited here, so a stale page never overwrites those calories.
    if (document.getElementById('f-eaten').value === loadedEaten) delete row.calories_eaten;

    try {
        // Daily log (calories / steps / sleep / water / notes). Don't create an empty row.
        if (!empty || dayHasEntry) {
            const { error: dErr } = await db.from('daily_log').upsert(row, { onConflict: 'log_date' });
            if (dErr) throw dErr;
            dayHasEntry = true;
            if ('calories_eaten' in row) loadedEaten = document.getElementById('f-eaten').value;
        }

        // Weight log
        if (weight !== null) {
            const { error: wErr } = await db.from('weight_log').upsert(
                { log_date: date, weight: weight }, { onConflict: 'log_date' });
            if (wErr) throw wErr;

            // Keep profile.current_weight in sync with the most recent weigh-in.
            const { data: latest } = await db.from('weight_log')
                .select('weight').order('log_date', { ascending: false }).limit(1);
            if (latest && latest.length) {
                // New bodyweight: with Auto macros, protein (2.25 g/kg) and the carbs/fat
                // that fill the target follow it. Custom macros are left alone.
                await db.from('profile').update({
                    current_weight: latest[0].weight,
                    ...(getMacroMode() === 'auto' ? calcMacroTargets(profile.daily_calorie_target, latest[0].weight) : {}),
                }).eq('id', 1);
                clearProfileCache();
                profile = await loadProfile();
            }
        }

        if (date === document.getElementById('f-date').value) await refreshBreakdown(date);
        await Promise.all([refreshCharts(), refreshHistory()]);
        return true;
    } catch (err) {
        showToast(t('common.errorSaving', { msg: err.message }), 'error');
        return false;
    }
}

// ---- Energy ring + burn breakdown ---------------------------
async function refreshBreakdown(date) {
    const { data: weightRows } = await db.from('weight_log')
        .select('log_date, weight').order('log_date', { ascending: true });
    const weightOn = buildWeightLookup(weightRows || []);
    const weight = weightOn(date);

    const { data: dLog } = await db.from('daily_log').select('*').eq('log_date', date).maybeSingle();
    const steps = dLog && dLog.steps ? Number(dLog.steps) : 0;
    const eaten = dLog && dLog.calories_eaten ? Number(dLog.calories_eaten) : null;
    const wBurn = await workoutBurnFor(date);

    const resting = calcRestingBurn(weight, profile);
    const stepsBurn = calcStepsBurn(steps, weight, profile);
    const total = resting + stepsBurn + wBurn;
    const target = Number(profile.daily_calorie_target);

    // Burn card: stacked bar + legend
    document.getElementById('burn-total').textContent = round(total).toLocaleString(LOCALE);
    document.getElementById('bd-resting').textContent = round(resting);
    document.getElementById('bd-steps').textContent = round(stepsBurn);
    document.getElementById('bd-workout').textContent = round(wBurn);
    const share = v => `${total ? (v / total) * 100 : 0}%`;
    document.getElementById('seg-rest').style.width = share(resting);
    document.getElementById('seg-steps').style.width = share(stepsBurn);
    document.getElementById('seg-workout').style.width = share(wBurn);

    // Energy card
    document.getElementById('bd-total').textContent = round(total).toLocaleString(LOCALE);
    document.getElementById('bd-eaten').textContent = eaten !== null ? eaten.toLocaleString(LOCALE) : '—';
    document.getElementById('e-target').textContent = t('trk.ofTarget', { n: target.toLocaleString(LOCALE) });

    // Ring: calories burned minus eaten. It fills with the share of the day's
    // burn you have eaten, and turns red once eating passes the burn (surplus).
    const balance = total - (eaten || 0);
    const surplus = balance < 0;
    const ring = document.getElementById('ring-fill');
    ring.style.strokeDasharray = RING_LENGTH;
    ring.style.strokeDashoffset = RING_LENGTH * (1 - Math.min(1, total ? (eaten || 0) / total : 0));
    ring.classList.toggle('over', surplus);
    const ringValue = document.getElementById('ring-value');
    ringValue.textContent = Math.abs(round(balance)).toLocaleString(LOCALE);
    ringValue.classList.toggle('bad', surplus);
    document.getElementById('ring-label').textContent = t(surplus ? 'trk.surplus' : 'trk.deficit');

    // Calories still to eat before reaching the daily target
    const leftEl = document.getElementById('bd-left');
    const left = target - (eaten || 0);
    leftEl.textContent = `${left < 0 ? '+' : ''}${Math.abs(round(left)).toLocaleString(LOCALE)}`;
    leftEl.classList.toggle('bad', left < 0);

    const hint = document.getElementById('bd-hint');
    if (eaten === null) hint.textContent = t('trk.enterCalories');
    else hint.textContent = surplus
        ? t('trk.surplusHint', { n: round(-balance) })
        : t('trk.deficitHint', { n: round(balance) });
}

// ---- Charts -------------------------------------------------
function showChart(which) {
    activeChart = which;
    document.querySelectorAll('.chart-tabs .main-tab').forEach(tab =>
        tab.classList.toggle('active', tab.dataset.chart === which));
    document.getElementById('weight-box').hidden = which !== 'weight';
    document.getElementById('net-box').hidden = which !== 'net';
    (which === 'weight' ? weightChart : netChart)?.resize();
    renderChartSummary();
    if (typeof springIn === 'function') springIn(document.getElementById(which + '-box'), which === 'net' ? 1 : -1);
}

let chartSummary = { weight: '', net: '' };
function renderChartSummary() {
    document.getElementById('chart-summary').innerHTML = chartSummary[activeChart] || '';
}

function resetChartBox(boxId, canvasId) {
    // An empty-state message may have replaced the canvas: put it back.
    const box = document.getElementById(boxId);
    if (!box.querySelector('canvas')) box.innerHTML = `<canvas id="${canvasId}"></canvas>`;
    return document.getElementById(canvasId);
}

async function refreshCharts() {
    const [{ data: weightRows }, { data: dailyRows }, { data: workoutRows }] = await Promise.all([
        db.from('weight_log').select('*').order('log_date', { ascending: true }),
        db.from('daily_log').select('*').gte('log_date', isoDaysAgo(29)).order('log_date', { ascending: true }),
        db.from('workouts').select('workout_date, calories_burned').gte('workout_date', isoDaysAgo(29)),
    ]);

    // Weight chart
    const wCtx = resetChartBox('weight-box', 'weight-chart');
    if (weightChart) { weightChart.destroy(); weightChart = null; }
    if ((weightRows || []).length) {
        const weights = weightRows.map(w => Number(w.weight));
        weightChart = new Chart(wCtx, {
            type: 'line',
            data: {
                labels: weightRows.map(w => formatDate(w.log_date)),
                datasets: [{
                    label: t('trk.weight'),
                    data: weights,
                    borderColor: cssVar('--primary'),
                    backgroundColor: withAlpha(cssVar('--primary'), .14),
                    tension: .35, fill: true, borderWidth: 2.5, pointHoverRadius: 5,
                    pointRadius: weights.length < 8 ? 4 : 0,      // few weigh-ins: show the dots
                    pointBackgroundColor: cssVar('--primary'),
                }],
            },
            options: chartOpts(v => v + ' kg'),
        });
        const change = round(weights[weights.length - 1] - weights[0], 1);
        chartSummary.weight = `<strong>${weights[weights.length - 1]} kg</strong>
            <span class="muted">${weights.length > 1 ? t('trk.weightChange', { d: (change > 0 ? '+' : '') + change }) : ''}</span>`;
    } else {
        wCtx.parentElement.innerHTML = `<p class="muted chart-empty">${t('trk.noWeight')}</p>`;
        chartSummary.weight = '';
    }

    // Net calorie chart
    const weightOn = buildWeightLookup(weightRows || []);
    const burnByDate = {};
    (workoutRows || []).forEach(w => {
        burnByDate[w.workout_date] = (burnByDate[w.workout_date] || 0) + Number(w.calories_burned || 0);
    });
    const logged = (dailyRows || []).filter(d => d.calories_eaten);

    const nCtx = resetChartBox('net-box', 'net-chart');
    if (netChart) { netChart.destroy(); netChart = null; }
    if (logged.length) {
        const nets = logged.map(d => {
            const w = weightOn(d.log_date);
            const burned = calcTotalBurned(w, Number(d.steps || 0), burnByDate[d.log_date] || 0, profile);
            return round(Number(d.calories_eaten) - burned);
        });
        netChart = new Chart(nCtx, {
            type: 'bar',
            data: {
                labels: logged.map(d => formatDate(d.log_date)),
                datasets: [{
                    label: t('trk.chartNet'),
                    data: nets,
                    backgroundColor: nets.map(n => cssVar(n < 0 ? '--success' : '--danger')),
                    borderRadius: 6, borderSkipped: false, maxBarThickness: 18,
                }],
            },
            options: chartOpts(v => v + ' kcal'),
        });
        const avg = round(nets.reduce((s, n) => s + n, 0) / nets.length);
        chartSummary.net = `<strong class="${avg < 0 ? 'good' : 'bad'}">${avg > 0 ? '+' : ''}${avg.toLocaleString(LOCALE)} kcal</strong>
            <span class="muted">${t('trk.avgNet')}</span>`;
    } else {
        nCtx.parentElement.innerHTML = `<p class="muted chart-empty">${t('trk.logToSeeTrend')}</p>`;
        chartSummary.net = '';
    }
    renderChartSummary();
}

// Charts take their colours from the theme tokens, so they follow light/dark mode.
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function withAlpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

function chartOpts(tickFmt) {
    const muted = cssVar('--text-soft');
    const grid = cssVar('--border');
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 } },
            y: { beginAtZero: false, grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: tickFmt, maxTicksLimit: 5 } },
        },
    };
}

// ---- Recent days list ---------------------------------------
async function refreshHistory() {
    const [{ data: dailyRows }, { data: weightRows }, { data: workoutRows }] = await Promise.all([
        db.from('daily_log').select('*').order('log_date', { ascending: false }).limit(30),
        db.from('weight_log').select('*').order('log_date', { ascending: true }),
        db.from('workouts').select('workout_date, calories_burned'),
    ]);

    const body = document.getElementById('history-body');
    const empty = document.getElementById('history-empty');
    if (!dailyRows || dailyRows.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    const weightOn = buildWeightLookup(weightRows || []);
    const weightExact = {};
    (weightRows || []).forEach(w => weightExact[w.log_date] = Number(w.weight));
    const burnByDate = {};
    (workoutRows || []).forEach(w => {
        burnByDate[w.workout_date] = (burnByDate[w.workout_date] || 0) + Number(w.calories_burned || 0);
    });
    const selected = document.getElementById('f-date').value;

    body.innerHTML = dailyRows.map(d => {
        const w = weightOn(d.log_date);
        const wBurn = burnByDate[d.log_date] || 0;
        const total = calcTotalBurned(w, Number(d.steps || 0), wBurn, profile);
        const eaten = d.calories_eaten;
        const parts = [];
        if (eaten) parts.push(`${Number(eaten).toLocaleString(LOCALE)} kcal`);
        if (d.steps) parts.push(`${Number(d.steps).toLocaleString(LOCALE)} ${t('trk.stepsUnit')}`);
        if (weightExact[d.log_date]) parts.push(`${weightExact[d.log_date]} kg`);
        if (wBurn) parts.push(`🔥 ${round(wBurn)}`);
        let net = '';
        if (eaten) {
            const n = eaten - total;
            net = `<span class="badge ${n < 0 ? 'green' : 'red'}">${n > 0 ? '+' : ''}${round(n)}</span>`;
        }
        return `<button type="button" class="day-row ${d.log_date === selected ? 'current' : ''}" data-date="${d.log_date}">
            <span class="day-row-main">
                <span class="day-row-date">${formatDate(d.log_date)}</span>
                <span class="day-row-sub">${parts.join(' · ') || escapeHtml(t('trk.noEntry'))}</span>
            </span>
            ${net}
            <span class="day-row-chev" aria-hidden="true"></span>
        </button>`;
    }).join('');

    body.querySelectorAll('.day-row').forEach(row => row.addEventListener('click', async () => {
        if (!(await confirmLeaveEdits())) return;
        document.getElementById('f-date').value = row.dataset.date;
        await loadDay();
        body.querySelectorAll('.day-row').forEach(r => r.classList.toggle('current', r === row));
        window.scrollTo({ top: 0, behavior: REDUCED_MOTION?.matches ? 'auto' : 'smooth' });
    }));
}
