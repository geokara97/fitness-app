// ============================================================
// Nutrition Plan page
// ============================================================

let selectedDayIdx = 0;

document.addEventListener('DOMContentLoaded', () => {
    renderNav('nutrition');

    const m = NUTRITION_PLAN.meta;
    document.getElementById('np-title').textContent = planText(m.title);
    document.getElementById('np-subtitle').textContent = planText(m.subtitle);
    document.getElementById('np-kcal').textContent = m.calories;
    document.getElementById('np-p').textContent = m.protein + ' g';
    document.getElementById('np-c').textContent = m.carbs + ' g';
    document.getElementById('np-f').textContent = m.fat + ' g';
    document.getElementById('np-notes').innerHTML = m.notes.map(n => `<li>${planText(n)}</li>`).join('');

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
        `<div class="day-tab ${i === selectedDayIdx ? 'active' : ''}" data-i="${i}">${t('dayShort.' + d.day)}</div>`
    ).join('');
    tabs.querySelectorAll('.day-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            selectedDayIdx = Number(tab.dataset.i);
            renderDayTabs();
            renderDay();
        });
    });
}

function renderDay() {
    const day = NUTRITION_PLAN.days[selectedDayIdx];
    const dayLabel = t('day.' + day.day);
    const P = t('np.P'), C = t('np.C'), F = t('np.F');
    document.getElementById('day-name').textContent = dayLabel;
    document.getElementById('day-total').textContent =
        `  ·  ~${day.total.kcal} kcal · ${P} ${day.total.p}g · ${C} ${day.total.c}g · ${F} ${day.total.f}g`;

    document.getElementById('meals').innerHTML = day.meals.map(meal => `
        <div class="card meal-card">
            <div class="meal-head">
                <h4>${t('meal.' + meal.name)}</h4>
                <div class="macro-pills">
                    <span class="macro-pill kcal">${meal.kcal} kcal</span>
                    <span class="macro-pill p">${P} ${meal.p}g</span>
                    <span class="macro-pill c">${C} ${meal.c}g</span>
                    <span class="macro-pill f">${F} ${meal.f}g</span>
                </div>
            </div>
            <ul class="meal-items">${meal.items.map(it => `<li>${planText(it)}</li>`).join('')}</ul>
        </div>
    `).join('');

    const btn = document.getElementById('log-day-btn');
    btn.textContent = t('np.logBtn', { day: dayLabel, kcal: day.total.kcal });
}

function renderRotation() {
    const r = NUTRITION_PLAN.rotation;
    const fill = (id, arr) => document.getElementById(id).innerHTML =
        arr.map(x => `<li>• ${planText(x)}</li>`).join('');
    fill('rot-protein', r.protein);
    fill('rot-carbs', r.carbs);
    fill('rot-fats', r.fats);

    document.getElementById('oil-swaps').innerHTML = NUTRITION_PLAN.oilSwaps.map(s =>
        `<tr><td>${planText(s[0])}</td><td class="muted">→</td><td><strong>${planText(s[1])}</strong></td></tr>`
    ).join('');
}

function renderTips() {
    document.getElementById('np-tips').innerHTML =
        NUTRITION_PLAN.tips.map((tip, i) => `<li><strong>${i + 1}.</strong> ${planText(tip)}</li>`).join('');
}

// Push the selected day's calorie total into today's daily_log.
async function logDayCalories() {
    const day = NUTRITION_PLAN.days[selectedDayIdx];
    const today = todayISO();
    try {
        const { data: existing } = await db.from('daily_log')
            .select('calories_eaten').eq('log_date', today).maybeSingle();
        if (existing && existing.calories_eaten &&
            !confirm(t('np.confirmReplace', { existing: existing.calories_eaten, kcal: day.total.kcal }))) {
            return;
        }
        const { error } = await db.from('daily_log').upsert(
            { log_date: today, calories_eaten: day.total.kcal }, { onConflict: 'log_date' });
        if (error) throw error;
        showToast(t('np.logged', { kcal: day.total.kcal }));
    } catch (err) {
        showToast(t('common.error', { msg: err.message }), 'error');
    }
}
