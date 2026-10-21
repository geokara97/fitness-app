// ============================================================
// Dashboard page
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('dashboard');
    try {
        const p = await loadProfile();
        await Promise.all([
            renderGoal(p),
            renderToday(p),
            renderWeek(p),
        ]);
    } catch (e) {
        console.error(e);
    }
});

// Latest recorded weight, falling back to the profile value.
async function latestWeight(p) {
    const { data } = await db.from('weight_log')
        .select('weight, log_date')
        .order('log_date', { ascending: false })
        .limit(1);
    return (data && data.length) ? Number(data[0].weight) : Number(p.current_weight);
}

async function renderGoal(p) {
    const current = await latestWeight(p);
    const start = Number(p.start_weight);
    const goal = Number(p.goal_weight);
    const totalToLose = start - goal;
    const lost = start - current;
    const remaining = current - goal;
    const pct = totalToLose > 0 ? Math.max(0, Math.min(100, (lost / totalToLose) * 100)) : 0;

    document.getElementById('goal-line').textContent = `${start} kg → ${goal} kg`;
    document.getElementById('goal-pct').textContent = `${round(pct)}%`;
    document.getElementById('goal-bar').style.width = `${pct}%`;
    document.getElementById('s-current').textContent = `${round(current, 1)} kg`;
    document.getElementById('s-lost').textContent = `${lost >= 0 ? '' : '+'}${round(Math.abs(lost), 1)} kg`;
    document.getElementById('s-remaining').textContent = `${round(Math.max(0, remaining), 1)} kg`;

    if (p.goal_date) {
        const days = Math.max(0, Math.round((new Date(p.goal_date) - new Date()) / 86400000));
        document.getElementById('s-days').textContent = days;
        document.getElementById('goal-date-line').textContent =
            `Target date ${new Date(p.goal_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else {
        document.getElementById('s-days').textContent = '—';
    }
}

async function renderToday(p) {
    const today = todayISO();
    const [dailyRes, weightRes, workoutRes] = await Promise.all([
        db.from('daily_log').select('*').eq('log_date', today).maybeSingle(),
        db.from('weight_log').select('weight').lte('log_date', today).order('log_date', { ascending: false }).limit(1),
        db.from('workouts').select('calories_burned').eq('workout_date', today),
    ]);

    const log = dailyRes.data;
    const weight = (weightRes.data && weightRes.data.length)
        ? Number(weightRes.data[0].weight) : Number(p.current_weight);
    const workoutBurn = (workoutRes.data || []).reduce((s, w) => s + Number(w.calories_burned || 0), 0);

    const eaten = log && log.calories_eaten ? Number(log.calories_eaten) : null;
    const steps = log && log.steps ? Number(log.steps) : 0;
    const totalBurned = calcTotalBurned(weight, steps, workoutBurn, p);

    document.getElementById('t-eaten').textContent = eaten !== null ? `${eaten}` : '—';
    document.getElementById('t-eaten-sub').textContent = `target ${p.daily_calorie_target}`;
    document.getElementById('t-burned').textContent = round(totalBurned);
    document.getElementById('t-workout').textContent = round(workoutBurn);
    document.getElementById('t-workout-sub').textContent =
        workoutBurn > 0 ? 'logged today' : 'no workout yet';

    const netEl = document.getElementById('t-net');
    if (eaten !== null) {
        const net = eaten - totalBurned;
        netEl.textContent = `${net > 0 ? '+' : ''}${round(net)}`;
        netEl.className = `value ${net < 0 ? 'good' : 'bad'}`;
        document.getElementById('t-net-sub').textContent =
            net < 0 ? 'deficit — losing fat' : 'surplus';
    } else {
        netEl.textContent = '—';
        document.getElementById('t-net-sub').textContent = 'log calories to see';
    }
}

async function renderWeek(p) {
    const from = isoDaysAgo(6);
    const today = todayISO();
    const [dailyRes, weightRes, workoutRes] = await Promise.all([
        db.from('daily_log').select('*').gte('log_date', from).lte('log_date', today),
        db.from('weight_log').select('*').order('log_date', { ascending: true }),
        db.from('workouts').select('workout_date, calories_burned').gte('workout_date', from).lte('workout_date', today),
    ]);

    const weights = weightRes.data || [];
    const weightOn = (date) => {
        let w = Number(p.current_weight);
        for (const row of weights) { if (row.log_date <= date) w = Number(row.weight); }
        return w;
    };
    const burnByDate = {};
    (workoutRes.data || []).forEach(w => {
        burnByDate[w.workout_date] = (burnByDate[w.workout_date] || 0) + Number(w.calories_burned || 0);
    });

    const logged = (dailyRes.data || []).filter(d => d.calories_eaten);
    let sumEaten = 0, sumBurned = 0;
    logged.forEach(d => {
        const w = weightOn(d.log_date);
        const burned = calcTotalBurned(w, Number(d.steps || 0), burnByDate[d.log_date] || 0, p);
        sumEaten += Number(d.calories_eaten);
        sumBurned += burned;
    });

    const workouts = new Set((workoutRes.data || []).map(w => w.workout_date)).size;
    document.getElementById('w-workouts').textContent = `${workouts}/5`;

    if (logged.length === 0) {
        ['w-eaten', 'w-burned', 'w-deficit'].forEach(id => document.getElementById(id).textContent = '—');
        document.getElementById('w-loss').textContent = 'no data logged';
        return;
    }
    const avgEaten = sumEaten / logged.length;
    const avgBurned = sumBurned / logged.length;
    const avgNet = avgEaten - avgBurned;
    document.getElementById('w-eaten').textContent = round(avgEaten);
    document.getElementById('w-burned').textContent = round(avgBurned);

    const defEl = document.getElementById('w-deficit');
    defEl.textContent = `${avgNet > 0 ? '+' : ''}${round(avgNet)}`;
    defEl.className = `value ${avgNet < 0 ? 'good' : 'bad'}`;

    const weeklyLoss = (-avgNet * 7) / KCAL_PER_KG_FAT;
    document.getElementById('w-loss').textContent =
        avgNet < 0 ? `≈ ${round(weeklyLoss, 2)} kg/week` : 'surplus this week';
}
