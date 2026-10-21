// ============================================================
// Workout History page
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    renderNav('history');
    loadHistory();
});

function durationLabel(seconds) {
    const m = Math.round((seconds || 0) / 60);
    if (m < 60) return t('hist.min', { m });
    return t('hist.hm', { h: Math.floor(m / 60), m: m % 60 });
}

async function loadHistory() {
    const { data, error } = await db.from('workouts')
        .select(`*, splits(split_name),
                 workout_exercises(*, exercises(exercise_name))`)
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

function renderWorkout(w) {
    // Group sets by exercise (order).
    const groups = {};
    (w.workout_exercises || []).forEach(we => {
        const key = `${we.exercise_order}-${we.exercise_id}`;
        if (!groups[key]) {
            groups[key] = {
                order: we.exercise_order || 0,
                name: we.exercises ? we.exercises.exercise_name : t('hist.exercise'),
                sets: [],
            };
        }
        groups[key].sets.push(we);
    });
    const exList = Object.values(groups).sort((a, b) => a.order - b.order);

    const exHtml = exList.length ? `
        <div class="exercise-list" style="margin-top:10px">
            ${exList.map(ex => `
                <div style="margin-bottom:8px">
                    <strong>${ex.name}</strong>
                    <div class="muted text-sm">
                        ${ex.sets.sort((a, b) => (a.set_number || 0) - (b.set_number || 0))
                            .map((s, i) => t('hist.set', { n: s.set_number || i + 1, reps: s.reps || '–' }) + (s.weight ? ' × ' + s.weight + ' kg' : ''))
                            .join('  ·  ')}
                    </div>
                </div>`).join('')}
        </div>` : `<p class="muted text-sm" style="margin-top:8px">${t('hist.noExercises')}</p>`;

    return `
        <div class="card" style="margin-bottom:14px">
            <div class="flex-between">
                <div>
                    <strong style="font-size:1.05rem">${formatDate(w.workout_date)}</strong>
                    ${w.splits ? `<span class="badge blue" style="margin-left:6px">${w.splits.split_name}</span>` : ''}
                </div>
                <button class="icon-btn" title="${t('common.delete')}" onclick="deleteWorkout(${w.workout_id})">×</button>
            </div>
            <div class="grid cols-3" style="margin:12px 0">
                <div class="stat"><div class="label">${t('hist.duration')}</div><div class="value" style="font-size:1.2rem">${durationLabel(w.duration_seconds)}</div></div>
                <div class="stat"><div class="label">${t('common.caloriesBurned')}</div><div class="value" style="font-size:1.2rem">🔥 ${round(w.calories_burned)}</div></div>
                <div class="stat"><div class="label">${t('hist.bodyweight')}</div><div class="value" style="font-size:1.2rem">${w.bodyweight ? w.bodyweight + ' kg' : '—'}</div></div>
            </div>
            ${w.notes ? `<p class="muted text-sm">📝 ${w.notes}</p>` : ''}
            ${exHtml}
        </div>`;
}

async function deleteWorkout(id) {
    if (!confirm(t('hist.confirmDelete'))) return;
    const { error } = await db.from('workouts').delete().eq('workout_id', id);
    if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
    showToast(t('hist.deleted'));
    loadHistory();
}
