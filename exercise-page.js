// ============================================================
// Exercise hub — quick stats + links to log / history / library
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('exercise');

    const [workoutsRes, countRes] = await Promise.all([
        db.from('workouts').select('workout_date, duration_seconds, calories_burned')
            .order('workout_date', { ascending: false }),
        db.from('exercises').select('exercise_id').eq('is_active', true),
    ]);
    if (workoutsRes.error || countRes.error) {
        showToast(t('common.error', { msg: (workoutsRes.error || countRes.error).message }), 'error');
        return;
    }

    const workouts = workoutsRes.data || [];
    document.getElementById('ex-total').textContent = workouts.length;
    document.getElementById('ex-count').textContent = (countRes.data || []).length;

    // Workouts since Monday of this week.
    const d = new Date();
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const mondayISO = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    document.getElementById('ex-week').textContent = workouts.filter(w => w.workout_date >= mondayISO).length;

    if (workouts.length) {
        const last = workouts[0];
        document.getElementById('ex-last').textContent = formatDate(last.workout_date);
        document.getElementById('ex-last-sub').textContent =
            `${t('hist.min', { m: Math.round((last.duration_seconds || 0) / 60) })} · 🔥 ${round(last.calories_burned)} kcal`;
    }
});
