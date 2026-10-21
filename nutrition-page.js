// ============================================================
// Nutrition page — Meal Plan tab
// Shows the latest generated plan from the DB, or the built-in
// default plan (nutrition-data.js) until one is generated.
// ============================================================

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_ORDER = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

// Shared with nutrition-foods.js
const NUT = {
    foods: [],            // rows from `foods`
    foodsById: {},
    prefs: {},            // { food_id: 'like' | 'dislike' | 'allergy' }
    plan: null,           // { meta, days: [{ day, meals: [{ name, items: [{ food, grams }] }] }] }
    dbReady: false,       // nutrition tables exist and loaded
};

let selectedDayIdx = 0;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('nutrition');
    initMainTabs();

    // Default to today's weekday.
    const idx = DAY_NAMES.indexOf(dayName(todayISO()));
    selectedDayIdx = idx >= 0 ? idx : 0;

    renderPlan();      // show the default plan straight away
    renderTips();
    document.getElementById('log-day-btn').addEventListener('click', logDayCalories);
    document.getElementById('btn-generate').addEventListener('click', generatePlan);

    await loadNutritionData();
    renderPlan();
    if (typeof renderFoodsTab === 'function') renderFoodsTab();
});

// ---- Tabs ---------------------------------------------------
function initMainTabs() {
    const show = (tab) => {
        document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.getElementById('tab-plan').hidden = tab !== 'plan';
        document.getElementById('tab-foods').hidden = tab !== 'foods';
        history.replaceState(null, '', tab === 'foods' ? '#foods' : location.pathname);
    };
    document.querySelectorAll('.main-tab').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    show(location.hash === '#foods' ? 'foods' : 'plan');
}

// ---- Data ---------------------------------------------------
function foodName(food) {
    return (LANG === 'el' && food.name_el) ? food.name_el : food.name_en;
}

async function loadNutritionData() {
    try {
        const [foodsRes, prefsRes, planRes] = await Promise.all([
            db.from('foods').select('*').order('name_en'),
            db.from('food_preferences').select('food_id, preference'),
            db.from('meal_plans').select('*').order('plan_id', { ascending: false }).limit(1),
        ]);
        for (const r of [foodsRes, prefsRes, planRes]) if (r.error) throw r.error;

        NUT.foods = foodsRes.data || [];
        NUT.foodsById = Object.fromEntries(NUT.foods.map(f => [f.food_id, f]));
        NUT.prefs = Object.fromEntries((prefsRes.data || []).map(p => [p.food_id, p.preference]));
        NUT.dbReady = true;

        const planRow = (planRes.data || [])[0];
        NUT.plan = planRow ? await loadPlanItems(planRow) : null;
    } catch (err) {
        console.error('Nutrition tables not available:', err.message);
        NUT.dbReady = false;
        showToast(t('foods.dbMissing'), 'error');
    }
}

async function loadPlanItems(planRow) {
    const { data, error } = await db.from('meal_plan_items')
        .select('day_of_week, meal, food_id, grams, sort_order')
        .eq('plan_id', planRow.plan_id)
        .order('day_of_week').order('sort_order');
    if (error) throw error;

    const days = DAY_NAMES.map((day, i) => ({
        day,
        meals: MEAL_ORDER.map(name => ({
            name,
            items: (data || [])
                .filter(it => it.day_of_week === i + 1 && it.meal === name && NUT.foodsById[it.food_id])
                .map(it => ({ food: NUT.foodsById[it.food_id], grams: Number(it.grams) })),
        })).filter(m => m.items.length),
    }));
    return { meta: planRow, days };
}

// ---- Macro maths --------------------------------------------
function macrosOf(items) {
    return items.reduce((s, { food, grams }) => {
        const r = grams / 100;
        s.kcal += Number(food.kcal) * r;
        s.p += Number(food.protein) * r;
        s.c += Number(food.carbs) * r;
        s.f += Number(food.fat) * r;
        return s;
    }, { kcal: 0, p: 0, c: 0, f: 0 });
}

function itemLabel({ food, grams }) {
    const name = escapeHtml(foodName(food));
    const piece = Number(food.piece_grams);
    if (piece > 0) {
        const n = Math.round(grams / piece);
        return `${n} × ${name} <span class="muted">(${round(grams)} g)</span>`;
    }
    return `${round(grams)} g ${name}`;
}

// Normalised view of the selected day: { label, total, meals: [{ name, kcal, p, c, f, itemsHtml[] }] }
function currentDayView() {
    if (NUT.plan) {
        const day = NUT.plan.days[selectedDayIdx];
        const meals = day.meals.map(m => {
            const mm = macrosOf(m.items);
            return { name: m.name, kcal: round(mm.kcal), p: round(mm.p), c: round(mm.c), f: round(mm.f),
                     itemsHtml: m.items.map(itemLabel) };
        });
        const tot = macrosOf(day.meals.flatMap(m => m.items));
        return { day: day.day, total: { kcal: round(tot.kcal), p: round(tot.p), c: round(tot.c), f: round(tot.f) }, meals };
    }
    const day = NUTRITION_PLAN.days.find(d => d.day === DAY_NAMES[selectedDayIdx]) || NUTRITION_PLAN.days[0];
    return {
        day: day.day,
        total: day.total,
        meals: day.meals.map(m => ({ ...m, itemsHtml: m.items.map(it => escapeHtml(planText(it))) })),
    };
}

// ---- Rendering ----------------------------------------------
function renderPlan() {
    const banner = document.getElementById('plan-banner-text');
    const genBtn = document.getElementById('btn-generate');
    genBtn.disabled = !NUT.dbReady;

    if (NUT.plan) {
        const m = NUT.plan.meta;
        document.getElementById('np-title').textContent = t('np.myPlanTitle');
        document.getElementById('np-subtitle').textContent = t('np.myPlanSubtitle', { kcal: m.kcal_target });
        setTargets(m.kcal_target, m.protein_target, m.carbs_target, m.fat_target);
        banner.textContent = t('np.bannerGenerated', {
            date: new Date(m.created_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }),
        });
        genBtn.textContent = t('np.regenerate');
        document.getElementById('np-notes').innerHTML =
            [planText(NUTRITION_PLAN.meta.notes[0]), t('np.noteGenerated')].map(n => `<li>${escapeHtml(n)}</li>`).join('');
    } else {
        const m = NUTRITION_PLAN.meta;
        document.getElementById('np-title').textContent = planText(m.title);
        document.getElementById('np-subtitle').textContent = planText(m.subtitle);
        setTargets(m.calories, m.protein, m.carbs, m.fat);
        banner.textContent = NUT.dbReady ? t('np.bannerDefault') : t('foods.dbMissing');
        genBtn.textContent = t('np.generate');
        document.getElementById('np-notes').innerHTML =
            m.notes.map(n => `<li>${escapeHtml(planText(n))}</li>`).join('');
    }

    renderDayTabs();
    renderDay();
    renderRotation();
}

function setTargets(kcal, p, c, f) {
    document.getElementById('np-kcal').textContent = kcal;
    document.getElementById('np-p').textContent = p + ' g';
    document.getElementById('np-c').textContent = c + ' g';
    document.getElementById('np-f').textContent = f + ' g';
}

function renderDayTabs() {
    const tabs = document.getElementById('day-tabs');
    tabs.innerHTML = DAY_NAMES.map((d, i) =>
        `<div class="day-tab ${i === selectedDayIdx ? 'active' : ''}" data-i="${i}">${t('dayShort.' + d)}</div>`
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
    const view = currentDayView();
    const dayLabel = t('day.' + view.day);
    const P = t('np.P'), C = t('np.C'), F = t('np.F');
    document.getElementById('day-name').textContent = dayLabel;
    document.getElementById('day-total').textContent =
        `  ·  ~${view.total.kcal} kcal · ${P} ${view.total.p}g · ${C} ${view.total.c}g · ${F} ${view.total.f}g`;

    document.getElementById('meals').innerHTML = view.meals.map(meal => `
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
            <ul class="meal-items">${meal.itemsHtml.map(it => `<li>${it}</li>`).join('')}</ul>
        </div>
    `).join('');

    document.getElementById('log-day-btn').textContent =
        t('np.logBtn', { day: dayLabel, kcal: view.total.kcal });
}

// Liked foods when the user has marked any; otherwise the default rotation list.
function renderRotation() {
    const liked = NUT.foods.filter(f => NUT.prefs[f.food_id] === 'like');
    const fill = (id, names) => document.getElementById(id).innerHTML =
        names.length ? names.map(x => `<li>• ${escapeHtml(x)}</li>`).join('') : '<li class="muted">—</li>';

    if (liked.length) {
        document.getElementById('rot-title').textContent = t('np.rotateLiked');
        const by = (cats) => liked.filter(f => cats.includes(f.category)).map(foodName);
        fill('rot-protein', by(['protein']));
        fill('rot-carbs', by(['carbs', 'fruit']));
        fill('rot-fats', by(['fats']));
    } else {
        document.getElementById('rot-title').textContent = t('np.rotate');
        const r = NUTRITION_PLAN.rotation;
        fill('rot-protein', r.protein.map(planText));
        fill('rot-carbs', r.carbs.map(planText));
        fill('rot-fats', r.fats.map(planText));
    }

    document.getElementById('oil-swaps').innerHTML = NUTRITION_PLAN.oilSwaps.map(s =>
        `<tr><td>${escapeHtml(planText(s[0]))}</td><td class="muted">→</td><td><strong>${escapeHtml(planText(s[1]))}</strong></td></tr>`
    ).join('');
}

function renderTips() {
    document.getElementById('np-tips').innerHTML =
        NUTRITION_PLAN.tips.map((tip, i) => `<li><strong>${i + 1}.</strong> ${escapeHtml(planText(tip))}</li>`).join('');
}

// ---- Generate -----------------------------------------------
async function generatePlan() {
    if (!NUT.dbReady) { showToast(t('foods.dbMissing'), 'error'); return; }
    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    let newPlanId = null;
    try {
        clearProfileCache();
        const p = await loadProfile();
        const targets = {
            kcal: Number(p.daily_calorie_target),
            protein: Number(p.protein_target),
            carbs: Number(p.carbs_target),
            fat: Number(p.fat_target),
        };

        const { items, missing } = generateMealPlan(NUT.foods, NUT.prefs, targets);
        const blocking = missing.filter(m => m === 'protein' || m === 'carbs');
        if (!items.length || blocking.length) {
            showToast(t('np.genMissing', { groups: blocking.map(g => t('cat.' + g)).join(', ') || t('cat.protein') }), 'error');
            return;
        }

        const { data: plan, error: pErr } = await db.from('meal_plans').insert([{
            kcal_target: targets.kcal,
            protein_target: targets.protein,
            carbs_target: targets.carbs,
            fat_target: targets.fat,
        }]).select().single();
        if (pErr) throw pErr;
        newPlanId = plan.plan_id;

        const { error: iErr } = await db.from('meal_plan_items')
            .insert(items.map(it => ({ ...it, plan_id: newPlanId })));
        if (iErr) throw iErr;

        // Keep only the newest plan.
        await db.from('meal_plans').delete().lt('plan_id', newPlanId);

        NUT.plan = await loadPlanItems(plan);
        renderPlan();
        showToast(missing.includes('vegetables') ? t('np.generatedNoVeg') : t('np.generated'));
    } catch (err) {
        if (newPlanId) await db.from('meal_plans').delete().eq('plan_id', newPlanId);
        showToast(t('common.error', { msg: err.message }), 'error');
    } finally {
        btn.disabled = !NUT.dbReady;
    }
}

// ---- Log to tracker -----------------------------------------
// Push the selected day's calorie total into today's daily_log.
async function logDayCalories() {
    const kcal = currentDayView().total.kcal;
    const today = todayISO();
    try {
        const { data: existing } = await db.from('daily_log')
            .select('calories_eaten').eq('log_date', today).maybeSingle();
        if (existing && existing.calories_eaten &&
            !confirm(t('np.confirmReplace', { existing: existing.calories_eaten, kcal }))) {
            return;
        }
        const { error } = await db.from('daily_log').upsert(
            { log_date: today, calories_eaten: kcal }, { onConflict: 'log_date' });
        if (error) throw error;
        showToast(t('np.logged', { kcal }));
    } catch (err) {
        showToast(t('common.error', { msg: err.message }), 'error');
    }
}
