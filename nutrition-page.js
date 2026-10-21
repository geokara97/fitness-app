// ============================================================
// Nutrition page — Meal Plan tab
// Plans belong to calendar weeks (meal_plans.week_start = Monday).
// A week without a generated plan shows the built-in default plan
// (nutrition-data.js). Meals can be marked as eaten on today only;
// that adds their calories to today's Daily Tracker automatically.
// ============================================================

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_ORDER = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
const WEEKS_BACK = 12;    // how far the week arrows go
const WEEKS_AHEAD = 8;

// Shared with nutrition-foods.js and nutrition-meals.js
const NUT = {
    foods: [],            // rows from `foods`
    foodsById: {},
    prefs: {},            // { food_id: 'like' | 'dislike' | 'allergy' }
    plansByWeek: {},      // { 'YYYY-MM-DD' (Monday): meal_plans row }
    weekStart: null,      // Monday of the week on screen
    plan: null,           // plan of that week: { meta, days: [{ day, meals: [{ name, savedMealId, items: [{ food, grams }] }] }] }
    dbReady: false,       // nutrition tables exist and loaded
    savedMeals: [],       // [{ meal_id, name, meal_slot, rating, items: [{ food_id, grams, sort_order }] }]
    mealLog: [],          // meal_log rows from the last 5 weeks
    mealsReady: false,    // meals_schema.sql has been run
};

let selectedDayIdx = 0;

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('nutrition');
    initMainTabs();

    NUT.weekStart = mondayOf(todayISO());
    selectedDayIdx = dayIndexOf(todayISO());

    renderPlan();      // show the default plan straight away
    renderTips();
    document.getElementById('btn-generate').addEventListener('click', generatePlan);
    document.getElementById('meals').addEventListener('click', onPlanMealClick);
    document.getElementById('week-prev').addEventListener('click', () => changeWeek(-1));
    document.getElementById('week-next').addEventListener('click', () => changeWeek(1));
    document.getElementById('week-today').addEventListener('click', goToToday);
    // Swipe the week strip to move between weeks, like the Calendar app.
    if (typeof attachSwipe === 'function') {
        attachSwipe(document.getElementById('day-tabs'), {
            onLeft: () => changeWeek(1),
            onRight: () => changeWeek(-1),
        });
    }

    await loadNutritionData();
    renderPlan();
    if (typeof renderFoodsTab === 'function') renderFoodsTab();
    if (typeof renderMealsTab === 'function') renderMealsTab();
});

// ---- Tabs ---------------------------------------------------
const MAIN_TABS = ['plan', 'foods', 'meals'];

function initMainTabs() {
    let current = null;
    const show = (tab) => {
        document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        MAIN_TABS.forEach(name => { document.getElementById('tab-' + name).hidden = tab !== name; });
        history.replaceState(null, '', tab === 'plan' ? location.pathname : '#' + tab);
        if (current && current !== tab && typeof springIn === 'function') {
            springIn(document.getElementById('tab-' + tab), Math.sign(MAIN_TABS.indexOf(tab) - MAIN_TABS.indexOf(current)));
        }
        current = tab;
    };
    document.querySelectorAll('.main-tab').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    const fromHash = location.hash.slice(1);
    show(MAIN_TABS.includes(fromHash) ? fromHash : 'plan');
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.querySelector('.main-tabs'), '.main-tab');
}

// ---- Dates (local, YYYY-MM-DD) ------------------------------
function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoOf(d);
}

function dayIndexOf(iso) {                 // 0 = Monday … 6 = Sunday
    return (new Date(iso + 'T00:00:00').getDay() + 6) % 7;
}

function mondayOf(iso) {
    return addDays(iso, -dayIndexOf(iso));
}

function dateOfDay(dayIdx, weekStart = NUT.weekStart) {
    return addDays(weekStart, dayIdx);
}

function weeksFromNow(weekStart) {
    const ms = new Date(weekStart + 'T00:00:00') - new Date(mondayOf(todayISO()) + 'T00:00:00');
    return Math.round(ms / (7 * 86400000));
}

// "This week · 20–26 Oct"
function weekLabel(weekStart) {
    const n = weeksFromNow(weekStart);
    const rel = n === 0 ? t('np.weekThis') : n === 1 ? t('np.weekNext') : n === -1 ? t('np.weekLast')
        : n > 1 ? t('np.weekIn', { n }) : t('np.weekAgo', { n: -n });
    const start = new Date(weekStart + 'T00:00:00');
    const end = new Date(addDays(weekStart, 6) + 'T00:00:00');
    const sameMonth = start.getMonth() === end.getMonth();
    const from = start.toLocaleDateString(LOCALE, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const to = end.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    return `${rel} · ${from}–${to}`;
}

// "Wednesday 21 October"
function dayLabelFull(dayIdx, weekStart = NUT.weekStart) {
    const d = new Date(dateOfDay(dayIdx, weekStart) + 'T00:00:00');
    return `${t('day.' + DAY_NAMES[dayIdx])} ${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })}`;
}

function isTodaySelected() {
    return dateOfDay(selectedDayIdx) === todayISO();
}

// ---- Data ---------------------------------------------------
function foodName(food) {
    return (LANG === 'el' && food.name_el) ? food.name_el : food.name_en;
}

async function loadNutritionData() {
    try {
        const [foodsRes, prefsRes, plansRes] = await Promise.all([
            db.from('foods').select('*').order('name_en'),
            db.from('food_preferences').select('food_id, preference'),
            db.from('meal_plans').select('*').order('plan_id', { ascending: false }),
        ]);
        for (const r of [foodsRes, prefsRes, plansRes]) if (r.error) throw r.error;

        NUT.foods = foodsRes.data || [];
        NUT.foodsById = Object.fromEntries(NUT.foods.map(f => [f.food_id, f]));
        NUT.prefs = Object.fromEntries((prefsRes.data || []).map(p => [p.food_id, p.preference]));
        NUT.dbReady = true;

        // Before meals_schema.sql adds week_start, a plan counts for the week it was created in.
        NUT.plansByWeek = {};
        (plansRes.data || []).forEach(p => {
            const week = p.week_start || mondayOf(isoOf(new Date(p.created_at)));
            if (!NUT.plansByWeek[week]) NUT.plansByWeek[week] = p;   // newest first
        });

        await loadMealsData();
        await loadWeek(NUT.weekStart);
    } catch (err) {
        console.error('Nutrition tables not available:', err.message);
        NUT.dbReady = false;
        showToast(t('foods.dbMissing'), 'error');
    }
}

// Saved meals + recent meal log. Missing tables (meals_schema.sql not run) only
// disable the meal features; the rest of the page keeps working.
async function loadMealsData() {
    const [mealsRes, itemsRes, logRes] = await Promise.all([
        db.from('saved_meals').select('*').order('name'),
        db.from('saved_meal_items').select('*').order('sort_order'),
        db.from('meal_log').select('*').gte('eaten_on', isoDaysAgo(35)).order('eaten_on', { ascending: false }),
    ]);
    if (mealsRes.error || itemsRes.error || logRes.error) {
        console.warn('Meal tables not available — run meals_schema.sql');
        NUT.mealsReady = false;
        return;
    }
    const items = itemsRes.data || [];
    NUT.savedMeals = (mealsRes.data || []).map(m => ({ ...m, items: items.filter(it => it.meal_id === m.meal_id) }));
    NUT.mealLog = logRes.data || [];
    NUT.mealsReady = true;
}

async function loadPlanItems(planRow) {
    const { data, error } = await db.from('meal_plan_items')
        .select('*')
        .eq('plan_id', planRow.plan_id)
        .order('day_of_week').order('sort_order');
    if (error) throw error;

    const days = DAY_NAMES.map((day, i) => ({
        day,
        meals: MEAL_ORDER.map(name => {
            const rows = (data || []).filter(it => it.day_of_week === i + 1 && it.meal === name && NUT.foodsById[it.food_id]);
            return {
                name,
                savedMealId: rows.length && rows.every(r => r.saved_meal_id && r.saved_meal_id === rows[0].saved_meal_id)
                    ? rows[0].saved_meal_id : null,
                items: rows.map(it => ({ food: NUT.foodsById[it.food_id], grams: Number(it.grams) })),
            };
        }).filter(m => m.items.length),
    }));
    return { meta: planRow, days };
}

async function loadWeek(weekStart) {
    NUT.weekStart = weekStart;
    const row = NUT.plansByWeek[weekStart];
    NUT.plan = row ? await loadPlanItems(row) : null;
}

async function reloadPlan() {
    await loadWeek(NUT.weekStart);
    renderPlan();
}

async function changeWeek(delta) {
    const next = addDays(NUT.weekStart, delta * 7);
    const n = weeksFromNow(next);
    if (n < -WEEKS_BACK || n > WEEKS_AHEAD) return;
    try { await loadWeek(next); } catch (err) { showToast(t('common.error', { msg: err.message }), 'error'); }
    renderPlan();
    slideWeek(delta);
}

// The new week slides in from the side the user moved towards.
function slideWeek(direction) {
    if (typeof springIn !== 'function' || !direction) return;
    springIn(document.getElementById('day-tabs'), direction);
    springIn(document.getElementById('meals'), direction);
}

async function goToToday() {
    const direction = Math.sign(weeksFromNow(mondayOf(todayISO())) - weeksFromNow(NUT.weekStart));
    selectedDayIdx = dayIndexOf(todayISO());
    await loadWeek(mondayOf(todayISO()));
    renderPlan();
    slideWeek(direction);
}

// The plan row for a week, creating an empty one (current targets) if needed.
async function getOrCreatePlanForWeek(weekStart) {
    if (NUT.plansByWeek[weekStart]) return NUT.plansByWeek[weekStart];
    clearProfileCache();
    const p = await loadProfile();
    const { data, error } = await db.from('meal_plans').insert([{
        week_start: weekStart,
        kcal_target: Number(p.daily_calorie_target), protein_target: Number(p.protein_target),
        carbs_target: Number(p.carbs_target), fat_target: Number(p.fat_target),
    }]).select().single();
    if (error) throw error;
    NUT.plansByWeek[weekStart] = data;
    return data;
}

// Friendly message when week_start doesn't exist yet (meals_schema.sql not re-run).
function planSaveError(err) {
    return /week_start/i.test(err.message || '') ? t('np.weekDbMissing') : t('common.error', { msg: err.message });
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

// Normalised view of the selected day:
// { day, editable, total, meals: [{ name, kcal, p, c, f, itemsHtml[], savedName, eaten, empty }] }
function currentDayView() {
    const today = isTodaySelected();
    const eatenNow = slot => today && NUT.mealsReady && !!findTodayLog(slot);

    if (NUT.plan) {
        const day = NUT.plan.days[selectedDayIdx];
        // Every slot is listed; a deleted meal shows as an empty placeholder.
        const meals = MEAL_ORDER.map(slot => {
            const m = day.meals.find(x => x.name === slot);
            if (!m) return { name: slot, empty: true };
            const mm = macrosOf(m.items);
            const saved = m.savedMealId && NUT.savedMeals.find(s => s.meal_id === m.savedMealId);
            return { name: slot, kcal: round(mm.kcal), p: round(mm.p), c: round(mm.c), f: round(mm.f),
                     itemsHtml: m.items.map(itemLabel), savedName: saved ? saved.name : null, eaten: eatenNow(slot) };
        });
        const tot = macrosOf(day.meals.flatMap(m => m.items));
        return { day: day.day, editable: true, total: { kcal: round(tot.kcal), p: round(tot.p), c: round(tot.c), f: round(tot.f) }, meals };
    }
    const day = NUTRITION_PLAN.days.find(d => d.day === DAY_NAMES[selectedDayIdx]) || NUTRITION_PLAN.days[0];
    return {
        day: day.day,
        editable: false,
        total: day.total,
        meals: day.meals.map(m => ({ ...m, itemsHtml: m.items.map(it => escapeHtml(planText(it))), eaten: eatenNow(m.name) })),
    };
}

// ---- Rendering ----------------------------------------------
function renderPlan() {
    const banner = document.getElementById('plan-banner-text');
    const genBtn = document.getElementById('btn-generate');
    const isCurrentWeek = weeksFromNow(NUT.weekStart) === 0;
    genBtn.disabled = !NUT.dbReady;
    genBtn.hidden = !isCurrentWeek;   // plans are only generated for the current week

    if (NUT.plan) {
        const m = NUT.plan.meta;
        document.getElementById('np-title').textContent = t('np.myPlanTitle');
        document.getElementById('np-subtitle').textContent = t('np.myPlanSubtitle', { kcal: m.kcal_target });
        setTargets(m.kcal_target, m.protein_target, m.carbs_target, m.fat_target);
        banner.textContent = isCurrentWeek
            ? t('np.bannerWeekPlan', {
                week: weekLabel(NUT.weekStart),
                date: new Date(m.created_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }),
            })
            : t('np.bannerOtherWeekPlan', { week: weekLabel(NUT.weekStart) });
        genBtn.textContent = t('np.regenerate');
        document.getElementById('np-notes').innerHTML =
            [planText(NUTRITION_PLAN.meta.notes[0]), t('np.noteGenerated')].map(n => `<li>${escapeHtml(n)}</li>`).join('');
    } else {
        const m = NUTRITION_PLAN.meta;
        document.getElementById('np-title').textContent = planText(m.title);
        document.getElementById('np-subtitle').textContent = planText(m.subtitle);
        setTargets(m.calories, m.protein, m.carbs, m.fat);
        banner.textContent = !NUT.dbReady ? t('foods.dbMissing')
            : t(isCurrentWeek ? 'np.bannerNoWeekPlan' : 'np.bannerOtherWeekNoPlan', { week: weekLabel(NUT.weekStart) });
        genBtn.textContent = t('np.generate');
        document.getElementById('np-notes').innerHTML =
            m.notes.map(n => `<li>${escapeHtml(planText(n))}</li>`).join('');
    }

    renderWeekNav();
    renderDayTabs();
    renderDay();
    renderRotation();
}

// Daily targets; the day summary card shows the selected day against them.
let TARGETS = { kcal: 0, p: 0, c: 0, f: 0 };
function setTargets(kcal, p, c, f) {
    TARGETS = { kcal: Number(kcal), p: Number(p), c: Number(c), f: Number(f) };
}

function renderDaySummary(total) {
    const pct = (v, goal) => `scaleX(${goal ? Math.min(1, v / goal) : 0})`;
    document.getElementById('ds-kcal').textContent = Number(total.kcal).toLocaleString(LOCALE);
    document.getElementById('ds-kcal-target').textContent = ` / ${TARGETS.kcal.toLocaleString(LOCALE)} kcal`;
    for (const k of ['p', 'c', 'f']) {
        document.getElementById('dm-' + k).textContent = `${total[k]} / ${TARGETS[k]} g`;
        document.getElementById(`dm-${k}-bar`).style.transform = pct(total[k], TARGETS[k]);
    }
}

const MEAL_ICONS = { Breakfast: '🌅', Lunch: '🥗', Snack: '🍎', Dinner: '🌙' };

function renderWeekNav() {
    const n = weeksFromNow(NUT.weekStart);
    document.getElementById('week-label').textContent = weekLabel(NUT.weekStart);
    document.getElementById('week-prev').disabled = n <= -WEEKS_BACK;
    document.getElementById('week-next').disabled = n >= WEEKS_AHEAD;
    document.getElementById('week-today').hidden = n === 0 && isTodaySelected();
}

function renderDayTabs() {
    const tabs = document.getElementById('day-tabs');
    const today = todayISO();
    tabs.innerHTML = DAY_NAMES.map((d, i) => {
        const iso = dateOfDay(i);
        const num = new Date(iso + 'T00:00:00').getDate();
        return `<div class="day-tab ${i === selectedDayIdx ? 'active' : ''} ${iso === today ? 'today' : ''}" data-i="${i}">
                    <span>${t('dayShort.' + d)}</span> <strong>${num}</strong></div>`;
    }).join('');
    tabs.querySelectorAll('.day-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            selectedDayIdx = Number(tab.dataset.i);
            renderWeekNav();
            renderDayTabs();
            renderDay();
        });
    });
}

function renderDay() {
    const view = currentDayView();
    const today = isTodaySelected();
    const P = t('np.P'), C = t('np.C'), F = t('np.F');
    document.getElementById('day-name').innerHTML =
        escapeHtml(dayLabelFull(selectedDayIdx)) + (today ? ` <span class="badge green">${escapeHtml(t('np.today'))}</span>` : '');
    renderDaySummary(view.total);
    document.getElementById('eat-hint').textContent =
        !NUT.mealsReady ? '' : today ? t('np.eatHintToday') : t('np.eatHintOther');

    document.getElementById('meals').innerHTML = view.meals.map(meal => {
        if (meal.empty) {
            return `
                <div class="card meal-card meal-empty">
                    <span class="meal-icon" aria-hidden="true">${MEAL_ICONS[meal.name] || '🍽️'}</span>
                    <span class="meal-title"><strong>${t('meal.' + meal.name)}</strong><span class="meal-sub">${escapeHtml(t('np.mealRemoved'))}</span></span>
                    <button type="button" class="btn btn-ghost btn-sm" data-act="add" data-meal="${meal.name}">${escapeHtml(t('np.addMeal'))}</button>
                </div>`;
        }
        // "Mark as eaten" only for today's meals.
        const eatBtn = today && NUT.mealsReady
            ? `<button type="button" class="btn btn-sm eat-btn ${meal.eaten ? 'eaten' : ''}" data-act="eat" data-meal="${meal.name}"
                       aria-pressed="${meal.eaten}">${escapeHtml(t(meal.eaten ? 'meals.eaten' : 'meals.markEaten'))}</button>`
            : '';
        const editBtns = view.editable ? `
                <span class="meal-icon-actions">
                    <button type="button" class="pref-btn active" data-act="edit" data-meal="${meal.name}" title="${escapeHtml(t('np.editMeal'))}">✏️</button>
                    ${NUT.mealsReady ? `<button type="button" class="pref-btn active" data-act="save" data-meal="${meal.name}" title="${escapeHtml(t('np.saveAsMine'))}">⭐</button>` : ''}
                    <button type="button" class="icon-btn" data-act="delete" data-meal="${meal.name}" title="${escapeHtml(t('np.deleteMeal'))}">🗑</button>
                </span>` : '';
        const actions = eatBtn || editBtns ? `<div class="meal-actions">${eatBtn}${editBtns}</div>` : '';
        return `
            <div class="card meal-card ${meal.eaten ? 'meal-eaten' : ''}">
                <div class="meal-head">
                    <span class="meal-icon" aria-hidden="true">${MEAL_ICONS[meal.name] || '🍽️'}</span>
                    <span class="meal-title">
                        <h4>${t('meal.' + meal.name)}${meal.eaten ? ' <span class="eaten-check" aria-hidden="true">✓</span>' : ''}</h4>
                        ${meal.savedName ? `<span class="meal-sub saved-tag">⭐ ${escapeHtml(meal.savedName)}</span>` : ''}
                    </span>
                    <span class="meal-kcal"><strong>${meal.kcal}</strong> kcal</span>
                </div>
                <div class="macro-pills">
                    <span class="macro-pill p">${P} ${meal.p}g</span>
                    <span class="macro-pill c">${C} ${meal.c}g</span>
                    <span class="macro-pill f">${F} ${meal.f}g</span>
                </div>
                <ul class="meal-items">${meal.itemsHtml.map(it => `<li>${it}</li>`).join('')}</ul>
                ${actions}
            </div>`;
    }).join('');
}

// Liked foods when the user has marked any; otherwise the default rotation list.
function renderRotation() {
    const liked = NUT.foods.filter(f => NUT.prefs[f.food_id] === 'like');
    const fill = (id, names) => document.getElementById(id).innerHTML =
        names.length ? names.map(x => `<li>${escapeHtml(x)}</li>`).join('') : '<li class="muted">—</li>';

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

// ---- Generate (always the current week) ----------------------
async function generatePlan() {
    if (!NUT.dbReady) { showToast(t('foods.dbMissing'), 'error'); return; }
    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    const week = mondayOf(todayISO());
    try {
        clearProfileCache();
        const p = await loadProfile();
        const targets = {
            kcal: Number(p.daily_calorie_target),
            protein: Number(p.protein_target),
            carbs: Number(p.carbs_target),
            fat: Number(p.fat_target),
        };

        // Favourites (top-rated or eaten often) go into the plan first.
        const favourites = NUT.mealsReady ? favouritesFromLog(NUT.mealLog, NUT.savedMeals, todayISO()) : [];
        const { items: generated, missing, favouritesPlaced } =
            generateMealPlan(NUT.foods, NUT.prefs, targets, Math.random, favourites);
        // Without meals_schema.sql the saved_meal_id column doesn't exist yet.
        const items = NUT.mealsReady ? generated : generated.map(({ saved_meal_id, ...rest }) => rest);
        const blocking = missing.filter(m => m === 'protein' || m === 'carbs');
        if (!items.length || blocking.length) {
            showToast(t('np.genMissing', { groups: blocking.map(g => t('cat.' + g)).join(', ') || t('cat.protein') }), 'error');
            return;
        }

        // One plan per week: reuse this week's row (fresh targets), replace its meals.
        const existing = NUT.plansByWeek[week];
        let plan;
        if (existing) {
            const { data, error } = await db.from('meal_plans').update({
                kcal_target: targets.kcal, protein_target: targets.protein,
                carbs_target: targets.carbs, fat_target: targets.fat, created_at: new Date().toISOString(),
            }).eq('plan_id', existing.plan_id).select().single();
            if (error) throw error;
            const { error: dErr } = await db.from('meal_plan_items').delete().eq('plan_id', existing.plan_id);
            if (dErr) throw dErr;
            plan = data;
        } else {
            const { data, error } = await db.from('meal_plans').insert([{
                week_start: week,
                kcal_target: targets.kcal, protein_target: targets.protein,
                carbs_target: targets.carbs, fat_target: targets.fat,
            }]).select().single();
            if (error) throw error;
            plan = data;
        }
        NUT.plansByWeek[week] = plan;

        const { error: iErr } = await db.from('meal_plan_items')
            .insert(items.map(it => ({ ...it, plan_id: plan.plan_id })));
        if (iErr) throw iErr;

        await loadWeek(week);      // show the plan just generated
        renderPlan();
        showToast(missing.includes('vegetables') ? t('np.generatedNoVeg')
            : favouritesPlaced ? t('np.generatedFav', { n: favouritesPlaced })
            : t('np.generated'));
    } catch (err) {
        showToast(planSaveError(err), 'error');
        await reloadPlan().catch(() => {});
    } finally {
        btn.disabled = !NUT.dbReady;
    }
}

// ---- Plan meal actions --------------------------------------
function planDay() {
    return NUT.plan && NUT.plan.days[selectedDayIdx];
}

function planMeal(slot) {
    const day = planDay();
    return day && day.meals.find(m => m.name === slot);
}

async function onPlanMealClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const slot = btn.dataset.meal;

    if (btn.dataset.act === 'eat') {
        if (!isTodaySelected()) return;
        const meal = planMeal(slot);
        if (meal) {
            const saved = meal.savedMealId && NUT.savedMeals.find(s => s.meal_id === meal.savedMealId);
            await toggleEatenToday({
                slot, savedMealId: meal.savedMealId, name: saved ? saved.name : null,
                items: meal.items.map(it => ({ food_id: it.food.food_id, grams: it.grams })),
            });
        } else {
            // Default (built-in) plan: log the meal's listed totals.
            const def = currentDayView().meals.find(m => m.name === slot);
            await toggleEatenToday({
                slot, savedMealId: null, name: null, items: [],
                macros: { kcal: def.kcal, p: def.p, c: def.c, f: def.f },
            });
        }
        renderDay();
        return;
    }

    if (!NUT.plan) return;
    const meal = planMeal(slot);
    switch (btn.dataset.act) {
        case 'edit':
            openMealEditor({ mode: 'plan', slot, savedMealId: meal.savedMealId,
                             items: meal.items.map(it => ({ food_id: it.food.food_id, grams: it.grams })) });
            break;
        case 'add':
            openMealEditor({ mode: 'plan', slot, savedMealId: null, items: [] });
            break;
        case 'save':
            openMealEditor({ mode: 'saved', slot, linkPlanSlot: slot,
                             items: meal.items.map(it => ({ food_id: it.food.food_id, grams: it.grams })) });
            break;
        case 'delete': {
            const ok = await confirmToast(t('np.confirmDeleteMeal', { meal: t('meal.' + slot), day: dayLabelFull(selectedDayIdx) }),
                                          { okText: t('common.delete') });
            if (ok) await savePlanMeal(slot, [], null);
            break;
        }
    }
}

// Replace one meal of a plan day (empty items = delete it).
// Defaults to the day and week on screen; planRow targets another week.
async function savePlanMeal(slot, items, savedMealId, { dayIdx = selectedDayIdx, planRow = null, quiet = false } = {}) {
    const planId = (planRow || NUT.plan.meta).plan_id;
    const dayNo = dayIdx + 1;
    const { error: dErr } = await db.from('meal_plan_items').delete()
        .eq('plan_id', planId).eq('day_of_week', dayNo).eq('meal', slot);
    if (dErr) { showToast(t('common.error', { msg: dErr.message }), 'error'); return false; }

    if (items.length) {
        const rows = items.map((it, i) => ({
            plan_id: planId, day_of_week: dayNo, meal: slot, food_id: it.food_id,
            grams: it.grams, sort_order: i,
            ...(NUT.mealsReady ? { saved_meal_id: savedMealId || null } : {}),
        }));
        const { error } = await db.from('meal_plan_items').insert(rows);
        if (error) { showToast(t('common.errorSaving', { msg: error.message }), 'error'); await reloadPlan(); return false; }
    }
    if (quiet) return true;   // caller reloads once after several days
    await reloadPlan();
    showToast(items.length ? t('np.mealUpdated') : t('np.mealDeleted'));
    return true;
}

// After "save as my meal": mark the plan meal as that saved meal.
async function linkPlanMealToSaved(slot, mealId) {
    const { error } = await db.from('meal_plan_items').update({ saved_meal_id: mealId })
        .eq('plan_id', NUT.plan.meta.plan_id).eq('day_of_week', selectedDayIdx + 1).eq('meal', slot);
    if (!error) await reloadPlan();
}
