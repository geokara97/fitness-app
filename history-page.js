// ============================================================
// Workout History page
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    renderNav('exercise');
    document.getElementById('workout-list').addEventListener('click', onWorkoutClick);
    loadHistory();
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

async function loadHistory() {
    const { data, error } = await db.from('workouts')
        .select(`*, workout_splits(splits(split_name, split_name_el, sort_order)),
                 workout_exercises(*, exercises(exercise_name, exercise_name_el))`)
        .order('workout_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        showToast(t('hist.loadError', { msg: error.message }), 'error');
        return;
    }

    const list = document.getElementById('workout-list');
    const empty = document.getElementById('workout-empty');

    if (!data || data.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        ['h-total', 'h-time', 'h-cals'].forEach(id => document.getElementById(id).textContent = '0');
        return;
    }
    empty.style.display = 'none';

    const totalSecs = data.reduce((s, w) => s + (w.duration_seconds || 0), 0);
    const totalCals = data.reduce((s, w) => s + Number(w.calories_burned || 0), 0);
    document.getElementById('h-total').textContent = data.length;
    document.getElementById('h-time').textContent = durationLabel(totalSecs);
    document.getElementById('h-cals').textContent = round(totalCals);

    list.innerHTML = data.map(renderWorkout).join('');
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
                        <span class="wk-set-reps">${st.reps ? escapeHtml(t('hist.reps', { n: st.reps })) : '–'}</span>
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
