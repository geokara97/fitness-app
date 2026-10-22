// ============================================================
// Workout History page
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    renderNav('exercise');
    document.getElementById('workout-list').addEventListener('click', onWorkoutClick);

    // Calendar: tap a day for its week; arrows or a swipe change the month.
    document.getElementById('cal-grid').addEventListener('click', e => {
        const day = e.target.closest('.cal-day');
        if (!day) return;
        const d = day.dataset.day;
        if (monthOf(d) !== calMonth) { showMonth(monthOf(d), mondayOfIso(d)); return; }
        selectedWeek = mondayOfIso(d);
        renderCalendar();
        renderWeek();
        if (typeof springIn === 'function') springIn(document.getElementById('workout-list'), 1, 12);
    });
    const stepMonth = n => {
        showMonth(addMonths(calMonth, n));
        if (typeof springIn === 'function') springIn(document.getElementById('cal-grid'), n);
    };
    document.getElementById('cal-prev').addEventListener('click', () => stepMonth(-1));
    document.getElementById('cal-next').addEventListener('click', () => stepMonth(1));
    document.getElementById('cal-today').addEventListener('click', () => showMonth(monthOf(todayISO())));
    if (typeof attachSwipe === 'function') {
        attachSwipe(document.getElementById('hist-cal'), { onLeft: () => stepMonth(1), onRight: () => stepMonth(-1) });
    }
    showMonth(monthOf(todayISO()));
});

function onWorkoutClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'delete') { deleteWorkout(id); return; }
    if (btn.dataset.act === 'toggle') {
        const open = !openWorkouts.has(id);
        if (open) openWorkouts.add(id); else openWorkouts.delete(id);
        btn.closest('.wk-card').classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open);
        document.getElementById('wk-body-' + id).hidden = !open;
    }
}

function durationLabel(seconds) {
    const m = Math.round((seconds || 0) / 60);
    if (m < 60) return t('hist.min', { m });
    return t('hist.hm', { h: Math.floor(m / 60), m: m % 60 });
}

// ---- Calendar state ------------------------------------------
// The month on screen, and the week (Monday) whose sessions are listed.
let calMonth = null;          // 'YYYY-MM-01'
let selectedWeek = null;      // Monday 'YYYY-MM-DD'
let calWorkouts = [];         // every workout in the calendar grid

function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoOf(d);
}
function mondayOfIso(iso) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoOf(d);
}
function monthOf(iso) { return iso.slice(0, 8) + '01'; }
function addMonths(monthIso, n) {
    const d = new Date(monthIso + 'T00:00:00');
    d.setMonth(d.getMonth() + n);
    return isoOf(d);
}
// Monday before (or on) the 1st, through the Sunday after (or on) the last day.
function gridRange(monthIso) {
    const start = mondayOfIso(monthIso);
    const last = addDaysIso(addMonths(monthIso, 1), -1);
    return { start, end: addDaysIso(mondayOfIso(last), 6) };
}

function showMonth(monthIso, week = null) {
    calMonth = monthIso;
    const today = todayISO();
    // Current month: today's week; other months: the week of the 1st.
    selectedWeek = week || (monthOf(today) === monthIso ? mondayOfIso(today) : mondayOfIso(monthIso));
    loadHistory();
}

async function loadHistory() {
    const { start, end } = gridRange(calMonth);
    const { data, error } = await db.from('workouts')
        .select(`*, workout_splits(splits(split_name, split_name_el, sort_order)),
                 workout_exercises(*, exercises(exercise_name, exercise_name_el))`)
        .gte('workout_date', start).lte('workout_date', end)
        .order('workout_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        showToast(t('hist.loadError', { msg: error.message }), 'error');
        return;
    }
    calWorkouts = data || [];
    renderMonthStats();
    renderCalendar();
    renderWeek();
}

// Totals for the month on screen.
function renderMonthStats() {
    const inMonth = calWorkouts.filter(w => monthOf(w.workout_date) === calMonth);
    document.getElementById('h-total').textContent = inMonth.length;
    document.getElementById('h-time').textContent = durationLabel(inMonth.reduce((n, w) => n + (w.duration_seconds || 0), 0));
    document.getElementById('h-cals').textContent = round(inMonth.reduce((n, w) => n + Number(w.calories_burned || 0), 0));
}

function renderCalendar() {
    const { start, end } = gridRange(calMonth);
    const today = todayISO();
    document.getElementById('cal-title').textContent =
        new Date(calMonth + 'T00:00:00').toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
    // Jan 1 2024 was a Monday: weekday names in the app's language.
    document.getElementById('cal-weekdays').innerHTML = Array.from({ length: 7 }, (_, i) =>
        `<span>${escapeHtml(new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, { weekday: 'short' }))}</span>`).join('');

    const perDay = {};
    calWorkouts.forEach(w => { perDay[w.workout_date] = (perDay[w.workout_date] || 0) + 1; });
    let html = '';
    for (let week = start; week <= end; week = addDaysIso(week, 7)) {
        html += `<div class="cal-week ${week === selectedWeek ? 'selected' : ''}">`;
        for (let i = 0; i < 7; i++) {
            const day = addDaysIso(week, i);
            const n = perDay[day] || 0;
            const cls = [
                'cal-day',
                monthOf(day) !== calMonth ? 'other' : '',
                day === today ? 'today' : '',
                n ? 'has' : '',
            ].join(' ');
            html += `<button type="button" class="${cls}" data-day="${day}"
                        aria-label="${escapeHtml(formatDate(day))}${n ? ' · ' + escapeHtml(t('hist.nWorkouts', { n })) : ''}">
                        <span>${Number(day.slice(8))}</span>${n ? `<i class="cal-dot"></i>` : ''}</button>`;
        }
        html += '</div>';
    }
    document.getElementById('cal-grid').innerHTML = html;
    const onToday = monthOf(today) === calMonth && selectedWeek === mondayOfIso(today);
    document.getElementById('cal-today').hidden = onToday;
}

// Sessions of the chosen week, with the week's totals.
function renderWeek() {
    const end = addDaysIso(selectedWeek, 6);
    const week = calWorkouts.filter(w => w.workout_date >= selectedWeek && w.workout_date <= end);
    const fmt = (iso, opts) => new Date(iso + 'T00:00:00').toLocaleDateString(LOCALE, opts);
    const sameMonth = selectedWeek.slice(0, 7) === end.slice(0, 7);
    document.getElementById('week-title').textContent = '📅 ' + (selectedWeek === mondayOfIso(todayISO())
        ? t('hist.thisWeek')
        : `${fmt(selectedWeek, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`);

    const secs = week.reduce((n, w) => n + (w.duration_seconds || 0), 0);
    const kcal = week.reduce((n, w) => n + Number(w.calories_burned || 0), 0);
    document.getElementById('week-sum').innerHTML = week.length ? `
        <span class="wk-chip">💪 ${escapeHtml(t('hist.nWorkouts', { n: week.length }))}</span>
        <span class="wk-chip">⏱ ${escapeHtml(durationLabel(secs))}</span>
        <span class="wk-chip wk-kcal">🔥 ${round(kcal)} kcal</span>` : '';

    document.getElementById('workout-list').innerHTML = week.map(renderWorkout).join('');
    document.getElementById('workout-empty').style.display = week.length ? 'none' : 'block';
}

// Sessions are compact cards: date, splits, duration, calories and counts;
// tapping one opens its exercises and sets.
const openWorkouts = new Set();

function renderWorkout(w) {
    // Group sets by exercise (order).
    const groups = {};
    (w.workout_exercises || []).forEach(we => {
        const key = `${we.exercise_order}-${we.exercise_id}`;
        if (!groups[key]) {
            groups[key] = {
                order: we.exercise_order || 0,
                name: we.exercises
                    ? ((LANG === 'el' && we.exercises.exercise_name_el) || we.exercises.exercise_name)
                    : t('hist.exercise'),
                sets: [],
            };
        }
        groups[key].sets.push(we);
    });
    const exList = Object.values(groups).sort((a, b) => a.order - b.order);
    const setCount = exList.reduce((n, ex) => n + ex.sets.length, 0);

    const splits = (w.workout_splits || [])
        .map(ws => ws.splits).filter(Boolean)
        .sort((a, b) => a.sort_order - b.sort_order);
    const splitBadges = splits.length
        ? splits.map(sp => `<span class="badge blue">${escapeHtml((LANG === 'el' && sp.split_name_el) || sp.split_name)}</span>`).join('')
        : `<span class="muted text-sm">${escapeHtml(t('hist.noSplit'))}</span>`;

    const exHtml = exList.length ? exList.map(ex => `
        <div class="wk-ex">
            <div class="wk-ex-head">
                <strong>${escapeHtml(ex.name)}</strong>
                <span class="muted text-sm">${escapeHtml(t('hist.setsCount', { n: ex.sets.length }))}</span>
            </div>
            <ol class="wk-sets">
                ${ex.sets.sort((a, b) => (a.set_number || 0) - (b.set_number || 0)).map((st, i) => `
                    <li>
                        <span class="wk-set-no">${st.set_number || i + 1}</span>
                        <span class="wk-set-reps">${st.duration_seconds ? '⏱ ' + escapeHtml(formatDuration(st.duration_seconds))
                            : st.reps ? escapeHtml(t('hist.reps', { n: st.reps })) : '–'}</span>
                        <span class="wk-set-kg">${st.weight ? `${st.weight} kg` : ''}</span>
                    </li>`).join('')}
            </ol>
        </div>`).join('')
        : `<p class="muted text-sm">${escapeHtml(t('hist.noExercises'))}</p>`;

    const open = openWorkouts.has(w.workout_id);
    return `
        <div class="card wk-card ${open ? 'open' : ''}">
            <button type="button" class="wk-head" data-act="toggle" data-id="${w.workout_id}"
                    aria-expanded="${open}" aria-controls="wk-body-${w.workout_id}">
                <span class="wk-title">
                    <strong class="wk-date">${escapeHtml(formatDate(w.workout_date))}</strong>
                    <span class="wk-splits">${splitBadges}</span>
                </span>
                <span class="wk-chevron" aria-hidden="true"></span>
                <span class="wk-chips">
                    <span class="wk-chip">⏱ ${escapeHtml(durationLabel(w.duration_seconds))}</span>
                    <span class="wk-chip wk-kcal">🔥 ${round(w.calories_burned)} kcal</span>
                    <span class="wk-chip">💪 ${escapeHtml(t('hist.exCount', { n: exList.length, s: setCount }))}</span>
                </span>
            </button>
            <div class="wk-body" id="wk-body-${w.workout_id}" ${open ? '' : 'hidden'}>
                <div class="wk-meta">
                    <span>${escapeHtml(t('hist.bodyweight'))}: <strong>${w.bodyweight ? escapeHtml(w.bodyweight + ' kg') : '—'}</strong></span>
                    ${w.notes ? `<span>📝 ${escapeHtml(w.notes)}</span>` : ''}
                </div>
                ${exHtml}
                <div class="wk-actions">
                    <a class="btn btn-ghost btn-sm" href="workout.html?edit=${w.workout_id}" data-push>✏️ ${escapeHtml(t('hist.edit'))}</a>
                    <button type="button" class="btn btn-ghost btn-sm wk-delete" data-act="delete" data-id="${w.workout_id}">🗑 ${escapeHtml(t('common.delete'))}</button>
                </div>
            </div>
        </div>`;
}

async function deleteWorkout(id) {
    if (!(await confirmToast(t('hist.confirmDelete'), { okText: t('common.delete') }))) return;
    const { error } = await db.from('workouts').delete().eq('workout_id', id);
    if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
    openWorkouts.delete(id);
    showToast(t('hist.deleted'));
    loadHistory();
}
