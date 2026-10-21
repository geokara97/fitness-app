// ============================================================
// Nutrition Plan page
// ============================================================

let selectedDayIdx = 0;

document.addEventListener('DOMContentLoaded', () => {
    renderNav('nutrition');

    const m = NUTRITION_PLAN.meta;
    document.getElementById('np-title').textContent = m.title;
    document.getElementById('np-subtitle').textContent = m.subtitle;
    document.getElementById('np-kcal').textContent = m.calories;
    document.getElementById('np-p').textContent = m.protein + ' g';
    document.getElementById('np-c').textContent = m.carbs + ' g';
    document.getElementById('np-f').textContent = m.fat + ' g';
    document.getElementById('np-notes').innerHTML = m.notes.map(n => `<li>${n}</li>`).join('');

    // Default to today's weekday.
    const todayName = dayName(todayISO());
    const idx = NUTRITION_PLAN.days.findIndex(d => d.day === todayName);
    selectedDayIdx = idx >= 0 ? idx : 0;

    renderDayTabs();
    renderDay();
    renderRotation();
    renderTips();

    document.getElementById('log-day-btn').addEventListener('click', logDayCalories);
});

function renderDayTabs() {
    const tabs = document.getElementById('day-tabs');
    tabs.innerHTML = NUTRITION_PLAN.days.map((d, i) =>
        `<div class="day-tab ${i === selectedDayIdx ? 'active' : ''}" data-i="${i}">${d.day.slice(0, 3)}</div>`
    ).join('');
    tabs.querySelectorAll('.day-tab').forEach(t => {
        t.addEventListener('click', () => {
            selectedDayIdx = Number(t.dataset.i);
            renderDayTabs();
            renderDay();
        });
    });
}

function renderDay() {
    const day = NUTRITION_PLAN.days[selectedDayIdx];
    document.getElementById('day-name').textContent = day.day;
    document.getElementById('day-total').textContent =
        `  ·  ~${day.total.kcal} kcal · P ${day.total.p}g · C ${day.total.c}g · F ${day.total.f}g`;

    document.getElementById('meals').innerHTML = day.meals.map(meal => `
        <div class="card meal-card">
            <div class="meal-head">
                <h4>${meal.name}</h4>
                <div class="macro-pills">
                    <span class="macro-pill kcal">${meal.kcal} kcal</span>
                    <span class="macro-pill p">P ${meal.p}g</span>
                    <span class="macro-pill c">C ${meal.c}g</span>
                    <span class="macro-pill f">F ${meal.f}g</span>
                </div>
            </div>
            <ul class="meal-items">${meal.items.map(it => `<li>${it}</li>`).join('')}</ul>
        </div>
    `).join('');

    const btn = document.getElementById('log-day-btn');
    btn.textContent = `✓ Log ${day.day}'s ${day.total.kcal} kcal to today`;
}

function renderRotation() {
    const r = NUTRITION_PLAN.rotation;
    const fill = (id, arr) => document.getElementById(id).innerHTML =
        arr.map(x => `<li>• ${x}</li>`).join('');
    fill('rot-protein', r.protein);
    fill('rot-carbs', r.carbs);
    fill('rot-fats', r.fats);

    document.getElementById('oil-swaps').innerHTML = NUTRITION_PLAN.oilSwaps.map(s =>
        `<tr><td>${s[0]}</td><td class="muted">→</td><td><strong>${s[1]}</strong></td></tr>`
    ).join('');
}

function renderTips() {
    document.getElementById('np-tips').innerHTML =
        NUTRITION_PLAN.tips.map((t, i) => `<li><strong>${i + 1}.</strong> ${t}</li>`).join('');
}

// Push the selected day's calorie total into today's daily_log.
async function logDayCalories() {
    const day = NUTRITION_PLAN.days[selectedDayIdx];
    const today = todayISO();
    try {
        const { data: existing } = await db.from('daily_log')
            .select('calories_eaten').eq('log_date', today).maybeSingle();
        if (existing && existing.calories_eaten &&
            !confirm(`Today already has ${existing.calories_eaten} kcal logged. Replace with ${day.total.kcal}?`)) {
            return;
        }
        const { error } = await db.from('daily_log').upsert(
            { log_date: today, calories_eaten: day.total.kcal }, { onConflict: 'log_date' });
        if (error) throw error;
        showToast(`Logged ${day.total.kcal} kcal to today's tracker`);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}
