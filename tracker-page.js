// ============================================================
// Daily Tracker page
// ============================================================

let profile = null;
let weightChart = null;
let netChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('tracker');
    try {
        profile = await loadProfile();
    } catch (e) { return; }

    document.getElementById('f-date').value = todayISO();
    document.getElementById('f-date').addEventListener('change', loadDayIntoForm);
    document.getElementById('log-form').addEventListener('submit', handleSave);

    await loadDayIntoForm();
    await Promise.all([refreshCharts(), refreshHistory()]);
});

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

// ---- Form ---------------------------------------------------
async function loadDayIntoForm() {
    const date = document.getElementById('f-date').value;
    if (!date) return;

    const [dailyRes, weightRes] = await Promise.all([
        db.from('daily_log').select('*').eq('log_date', date).maybeSingle(),
        db.from('weight_log').select('weight').eq('log_date', date).maybeSingle(),
    ]);
    const d = dailyRes.data || {};
    document.getElementById('f-weight').value = weightRes.data ? weightRes.data.weight : '';
    document.getElementById('f-eaten').value = d.calories_eaten ?? '';
    document.getElementById('f-steps').value = d.steps ?? '';
    document.getElementById('f-sleep').value = d.sleep_hours ?? '';
    document.getElementById('f-water').value = d.water_liters ?? '';
    document.getElementById('f-notes').value = d.notes ?? '';

    await refreshBreakdown(date);
}

async function handleSave(e) {
    e.preventDefault();
    const date = document.getElementById('f-date').value;
    if (!date) return;

    const val = (id) => {
        const v = document.getElementById(id).value;
        return v === '' ? null : Number(v);
    };
    const weight = val('f-weight');
    const notes = document.getElementById('f-notes').value || null;

    try {
        // Daily log (calories / steps / sleep / water / notes)
        const { error: dErr } = await db.from('daily_log').upsert({
            log_date: date,
            calories_eaten: val('f-eaten'),
            steps: val('f-steps'),
            sleep_hours: val('f-sleep'),
            water_liters: val('f-water'),
            notes: notes,
        }, { onConflict: 'log_date' });
        if (dErr) throw dErr;

        // Weight log
        if (weight !== null) {
            const { error: wErr } = await db.from('weight_log').upsert(
                { log_date: date, weight: weight }, { onConflict: 'log_date' });
            if (wErr) throw wErr;

            // Keep profile.current_weight in sync with the most recent weigh-in.
            const { data: latest } = await db.from('weight_log')
                .select('weight').order('log_date', { ascending: false }).limit(1);
            if (latest && latest.length) {
                await db.from('profile').update({ current_weight: latest[0].weight }).eq('id', 1);
                clearProfileCache();
                profile = await loadProfile();
            }
        }

        showToast(t('trk.saved'));
        await Promise.all([refreshBreakdown(date), refreshCharts(), refreshHistory()]);
    } catch (err) {
        showToast(t('common.errorSaving', { msg: err.message }), 'error');
    }
}

// ---- Breakdown ----------------------------------------------
async function refreshBreakdown(date) {
    document.getElementById('bd-date').textContent =
        `${formatDate(date)} · ${new Date(date + 'T00:00:00').toLocaleDateString(LOCALE)}`;

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

    document.getElementById('bd-resting').textContent = round(resting);
    document.getElementById('bd-steps').textContent = round(stepsBurn);
    document.getElementById('bd-workout').textContent = round(wBurn);
    document.getElementById('bd-total').textContent = round(total);
    document.getElementById('bd-eaten').textContent = eaten !== null ? eaten : '—';

    const netEl = document.getElementById('bd-net');
    const hint = document.getElementById('bd-hint');
    if (eaten !== null) {
        const net = eaten - total;
        netEl.textContent = `${net > 0 ? '+' : ''}${round(net)} kcal`;
        netEl.style.color = net < 0 ? 'var(--success)' : 'var(--danger)';
        hint.textContent = net < 0
            ? t('trk.deficitHint', { n: round(-net) })
            : t('trk.surplusHint', { n: round(net) });
    } else {
        netEl.textContent = '—';
        netEl.style.color = '';
        hint.textContent = t('trk.enterCalories');
    }
}

// ---- Charts -------------------------------------------------
async function refreshCharts() {
    const [{ data: weightRows }, { data: dailyRows }, { data: workoutRows }] = await Promise.all([
        db.from('weight_log').select('*').order('log_date', { ascending: true }),
        db.from('daily_log').select('*').gte('log_date', isoDaysAgo(29)).order('log_date', { ascending: true }),
        db.from('workouts').select('workout_date, calories_burned').gte('workout_date', isoDaysAgo(29)),
    ]);

    // Weight chart
    const wCtx = document.getElementById('weight-chart');
    if (weightChart) weightChart.destroy();
    if ((weightRows || []).length) {
        weightChart = new Chart(wCtx, {
            type: 'line',
            data: {
                labels: weightRows.map(w => formatDate(w.log_date)),
                datasets: [{
                    label: t('trk.weight'),
                    data: weightRows.map(w => Number(w.weight)),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79,70,229,.12)',
                    tension: .35, fill: true, pointRadius: 3,
                }],
            },
            options: chartOpts(v => v + ' kg'),
        });
    } else {
        wCtx.parentElement.innerHTML = `<p class="muted" style="padding:20px">${t('trk.noWeight')}</p>`;
    }

    // Net calorie chart
    const weightAll = weightRows || [];
    const weightOn = buildWeightLookup(weightAll);
    const burnByDate = {};
    (workoutRows || []).forEach(w => {
        burnByDate[w.workout_date] = (burnByDate[w.workout_date] || 0) + Number(w.calories_burned || 0);
    });
    const logged = (dailyRows || []).filter(d => d.calories_eaten);

    const nCtx = document.getElementById('net-chart');
    if (netChart) netChart.destroy();
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
                    backgroundColor: nets.map(n => n < 0 ? 'rgba(16,185,129,.75)' : 'rgba(239,68,68,.75)'),
                }],
            },
            options: chartOpts(v => v + ' kcal'),
        });
    } else {
        nCtx.parentElement.innerHTML = `<p class="muted" style="padding:20px">${t('trk.logToSeeTrend')}</p>`;
    }
}

function chartOpts(tickFmt) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: false, ticks: { callback: tickFmt } } },
    };
}

// ---- History table ------------------------------------------
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

    body.innerHTML = dailyRows.map(d => {
        const w = weightOn(d.log_date);
        const wBurn = burnByDate[d.log_date] || 0;
        const total = calcTotalBurned(w, Number(d.steps || 0), wBurn, profile);
        const eaten = d.calories_eaten;
        let netCell = '—';
        if (eaten) {
            const net = eaten - total;
            netCell = `<span class="badge ${net < 0 ? 'green' : 'red'}">${net > 0 ? '+' : ''}${round(net)}</span>`;
        }
        return `<tr>
            <td>${formatDate(d.log_date)}</td>
            <td class="num">${weightExact[d.log_date] ? weightExact[d.log_date] + ' kg' : '—'}</td>
            <td class="num">${eaten || '—'}</td>
            <td class="num">${d.steps || '—'}</td>
            <td class="num">${wBurn ? round(wBurn) : '—'}</td>
            <td class="num">${round(total)}</td>
            <td class="num">${netCell}</td>
            <td class="num"><button class="icon-btn" title="${t('common.delete')}" onclick="deleteDay('${d.log_date}')">×</button></td>
        </tr>`;
    }).join('');
}

async function deleteDay(date) {
    if (!(await confirmToast(t('trk.confirmDelete', { date: formatDate(date) }), { okText: t('common.delete') }))) return;
    const { error } = await db.from('daily_log').delete().eq('log_date', date);
    if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
    showToast(t('trk.deleted'));
    await Promise.all([refreshHistory(), refreshCharts()]);
}
