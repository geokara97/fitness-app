// ============================================================
// Nutrition page — My Meals tab, the meal editor (shared with the
// plan), "Add to plan" for any upcoming week, and the meal log
// behind "Mark as eaten" (which also updates today's tracker calories).
// Uses NUT, foodName(), macrosOf(), itemLabel(), savePlanMeal(),
// linkPlanMealToSaved(), renderDay() and the date helpers from nutrition-page.js.
// ============================================================

let mealEditor = null;   // { mode: 'saved' | 'plan', mealId, slot, savedMealId, linkPlanSlot }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-new-meal').addEventListener('click', () =>
        openMealEditor({ mode: 'saved', slot: 'Lunch', items: [] }));
    document.getElementById('saved-meals-list').addEventListener('click', onSavedMealClick);
    document.getElementById('saved-meals-list').addEventListener('change', onRatingInput);

    document.getElementById('meal-modal-close').addEventListener('click', closeMealEditor);
    document.getElementById('meal-modal').addEventListener('click', e => {
        if (e.target.id === 'meal-modal') closeMealEditor();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMealEditor(); });
    document.getElementById('me-add-item').addEventListener('click', () => { addEditorRow(); updateEditorTotals(); });
    document.getElementById('me-items').addEventListener('input', updateEditorTotals);
    document.getElementById('me-items').addEventListener('click', e => {
        if (e.target.closest('.me-remove')) { e.target.closest('.me-row').remove(); updateEditorTotals(); }
    });
    document.getElementById('me-from-saved').addEventListener('change', fillEditorFromSaved);
    document.getElementById('meal-form').addEventListener('submit', saveMealEditor);

    document.getElementById('plan-add-close').addEventListener('click', closeAddToPlan);
    document.getElementById('plan-add-modal').addEventListener('click', e => {
        if (e.target.id === 'plan-add-modal') closeAddToPlan();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddToPlan(); });
    document.getElementById('pa-all').addEventListener('click', () => {
        const boxes = [...document.querySelectorAll('input[name="pa-day"]')];
        const allOn = boxes.every(b => b.checked);
        boxes.forEach(b => { b.checked = !allOn; });
    });
    document.getElementById('plan-add-form').addEventListener('submit', saveAddToPlan);
    document.getElementById('pa-week').addEventListener('change', e => renderAddToPlanDays(e.target.value));
});

// ---- Rating -------------------------------------------------
// What a rating does to generated plans (mirrors ratingDays in meal-generator.js).
function ratingHint(rating) {
    if (!rating) return t('meals.notRated');
    if (rating <= 3) return t('meals.ratingNever');
    const days = ratingDays(rating);
    return days ? t('meals.ratingDays', { n: days }) : t('meals.ratingNoExtra');
}

function ratingRowHtml(m) {
    const r = m.rating ? Number(m.rating) : 0;
    // Whole-number buttons for a quick tap; the field takes decimals (e.g. 7.5).
    const pills = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
        <button type="button" class="rate-pill ${n === r ? 'active' : n <= r ? 'filled' : ''}" data-act="rate" data-id="${m.meal_id}"
                data-rating="${n}" aria-pressed="${n === r}" aria-label="${escapeHtml(t('meals.rateAria', { n }))}">${n}</button>`).join('');
    return `
        <div class="rating-row">
            <span class="rating-label">${escapeHtml(t('meals.rating'))}</span>
            <div class="rating-pills" role="group" aria-label="${escapeHtml(t('meals.rating'))}">${pills}</div>
            <input type="text" class="rating-input" data-id="${m.meal_id}" inputmode="decimal" maxlength="4" autocomplete="off"
                   value="${r ? r : ''}" placeholder="–" aria-label="${escapeHtml(t('meals.ratingField'))}" title="${escapeHtml(t('meals.ratingField'))}">
            <span class="muted text-sm rating-hint">${escapeHtml(ratingHint(r))}</span>
        </div>`;
}

// A typed rating: empty clears it; otherwise 1–10, rounded to one decimal.
function parseRating(value) {
    if (value === '' || value == null) return { ok: true, rating: null };
    const n = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 1 || n > 10) return { ok: false };
    return { ok: true, rating: Math.round(n * 10) / 10 };
}

async function onRatingInput(e) {
    const input = e.target.closest('.rating-input');
    if (!input) return;
    const m = NUT.savedMeals.find(x => x.meal_id === Number(input.dataset.id));
    if (!m) return;
    const { ok, rating } = parseRating(input.value);
    if (!ok) { showToast(t('meals.ratingInvalid'), 'error'); renderMealsTab(); return; }
    if (rating === (m.rating ? Number(m.rating) : null)) return;
    await setMealRating(m, rating, { toggle: false });
}

// Tapping the current rating button again clears it; the field sets it exactly.
async function setMealRating(m, rating, { toggle = true } = {}) {
    const next = toggle && Number(m.rating) === rating ? null : rating;
    const before = m.rating;
    m.rating = next;
    renderMealsTab();
    const { error } = await db.from('saved_meals').update({ rating: next }).eq('meal_id', m.meal_id);
    if (error) {
        m.rating = before;
        renderMealsTab();
        showToast(mealSaveError(error), 'error');
    }
}

// ---- Add a saved meal to days of this or an upcoming week ----
const ADD_TO_PLAN_WEEKS = 4;    // this week + the next 3
let addToPlanMeal = null;

function openAddToPlan(m) {
    if (!NUT.dbReady) return;
    addToPlanMeal = m;
    document.getElementById('pa-title').textContent = t('meals.addToPlanTitle', { name: m.name });
    document.getElementById('pa-hint').textContent = t('meals.addToPlanHint', { meal: t('meal.' + m.meal_slot) });
    const thisWeek = mondayOf(todayISO());
    const weekSel = document.getElementById('pa-week');
    weekSel.innerHTML = Array.from({ length: ADD_TO_PLAN_WEEKS }, (_, i) => addDays(thisWeek, i * 7))
        .map(w => `<option value="${w}">${escapeHtml(weekLabel(w))}</option>`).join('');
    // Start on the week being viewed, if it's one of the options.
    weekSel.value = weeksFromNow(NUT.weekStart) >= 0 && weeksFromNow(NUT.weekStart) < ADD_TO_PLAN_WEEKS ? NUT.weekStart : thisWeek;
    document.getElementById('plan-add-modal').classList.add('show');
    renderAddToPlanDays(weekSel.value);
}

// Day checkboxes (with dates) and what each day has now in that week's plan.
async function renderAddToPlanDays(weekStart) {
    const m = addToPlanMeal;
    const box = document.getElementById('pa-days');
    box.innerHTML = `<p class="muted text-sm">${escapeHtml(t('foods.searching'))}</p>`;
    let plan = null;
    try {
        const row = NUT.plansByWeek[weekStart];
        plan = weekStart === NUT.weekStart ? NUT.plan : row ? await loadPlanItems(row) : null;
    } catch (err) { /* treat as no plan */ }
    if (!m || document.getElementById('pa-week').value !== weekStart) return;   // changed meanwhile

    const today = todayISO();
    box.innerHTML = DAY_NAMES.map((day, i) => {
        const iso = dateOfDay(i, weekStart);
        const past = iso < today;
        const current = plan && plan.days[i].meals.find(x => x.name === m.meal_slot);
        const saved = current && current.savedMealId && NUT.savedMeals.find(s => s.meal_id === current.savedMealId);
        const already = current && current.savedMealId === m.meal_id;
        const now = !plan ? t('meals.noPlanYet') : !current ? t('meals.slotEmpty')
            : `${round(macrosOf(current.items).kcal)} kcal${saved ? ' · ⭐ ' + saved.name : ''}`;
        return `
            <label class="pa-day ${already ? 'already' : ''} ${past ? 'past' : ''}">
                <input type="checkbox" name="pa-day" value="${i}" ${past ? 'disabled' : ''}>
                <span class="pa-day-name">${escapeHtml(dayLabelFull(i, weekStart))}</span>
                <span class="muted text-sm">${escapeHtml(past ? t('meals.dayPast') : already ? t('meals.alreadyThere') : t('meals.currently', { what: now }))}</span>
            </label>`;
    }).join('');
}

function closeAddToPlan() {
    document.getElementById('plan-add-modal').classList.remove('show');
    addToPlanMeal = null;
}

async function saveAddToPlan(e) {
    e.preventDefault();
    const m = addToPlanMeal;
    if (!m) return;
    const weekStart = document.getElementById('pa-week').value;
    const days = [...document.querySelectorAll('input[name="pa-day"]:checked')].map(c => Number(c.value));
    if (!days.length) { showToast(t('meals.pickDays'), 'error'); return; }
    const items = m.items.filter(it => NUT.foodsById[it.food_id])
        .map(it => ({ food_id: it.food_id, grams: Number(it.grams) }));
    if (!items.length) { showToast(t('meals.needFood'), 'error'); return; }

    const btn = document.getElementById('pa-save');
    btn.disabled = true;
    let ok = 0;
    try {
        const planRow = await getOrCreatePlanForWeek(weekStart);   // a week without a plan gets one
        for (const dayIdx of days) {
            if (await savePlanMeal(m.meal_slot, items, m.meal_id, { dayIdx, planRow, quiet: true })) ok++;
        }
    } catch (err) {
        showToast(planSaveError(err), 'error');
    }
    btn.disabled = false;
    closeAddToPlan();
    if (weekStart === NUT.weekStart) await reloadPlan();
    if (ok) showToast(t('meals.addedToDays', { name: m.name, n: ok, week: weekLabel(weekStart) }));
}

// ---- Helpers ------------------------------------------------
// [{ food_id, grams }] -> [{ food, grams }] (drops foods that no longer exist)
function withFoods(items) {
    return items.filter(it => NUT.foodsById[it.food_id])
        .map(it => ({ food: NUT.foodsById[it.food_id], grams: Number(it.grams) }));
}

function savedMealSignature(m) {
    return mealSignature(m.meal_id, []);
}

function macroPillsHtml(mm) {
    return `
        <span class="macro-pill kcal">${round(mm.kcal)} kcal</span>
        <span class="macro-pill p">${t('np.P')} ${round(mm.p)}g</span>
        <span class="macro-pill c">${t('np.C')} ${round(mm.c)}g</span>
        <span class="macro-pill f">${t('np.F')} ${round(mm.f)}g</span>`;
}

// ---- Meal log -----------------------------------------------
// One "eaten" entry per meal slot per day (breakfast, lunch, snack, dinner),
// on any day — past, today or ahead. Each entry's calories are counted in that
// day's "Calories eaten" in the Daily Tracker.
function findLog(dateIso, slot) {
    return NUT.mealLog.find(l => l.eaten_on === dateIso && l.meal === slot);
}

// Eaten meals for a date range (a week being shown), merged into NUT.mealLog.
async function loadMealLogRange(fromIso, toIso) {
    if (!NUT.mealsReady) return;
    const { data, error } = await db.from('meal_log').select('*').gte('eaten_on', fromIso).lte('eaten_on', toIso);
    if (error) return;
    const inRange = l => l.eaten_on >= fromIso && l.eaten_on <= toIso;
    NUT.mealLog = NUT.mealLog.filter(l => !inRange(l)).concat(data || []);
}

// Add (or subtract) calories to a day's "Calories eaten" in the Daily Tracker.
// Adjusting instead of overwriting keeps any manual edits made in the tracker.
async function adjustCaloriesEaten(dateIso, delta) {
    const { data: row, error } = await db.from('daily_log')
        .select('calories_eaten').eq('log_date', dateIso).maybeSingle();
    if (error) throw error;
    const next = Math.max(0, Math.round(Number(row && row.calories_eaten || 0) + delta));
    const { error: uErr } = await db.from('daily_log')
        .upsert({ log_date: dateIso, calories_eaten: next }, { onConflict: 'log_date' });
    if (uErr) throw uErr;
    return next;
}

// Times eaten (any slot) in the favourites window.
function timesEaten(signature) {
    const since = isoDaysAgo(FAVOURITE_WEEKS * 7 - 1);
    return NUT.mealLog.filter(l => l.signature === signature && l.eaten_on >= since).length;
}

// The meal_log fields describing what was eaten (foods snapshot + totals).
// Whole kcal: exactly what is added is what unmarking takes off later.
function mealLogFields(slot, savedMealId, name, items, macros = null) {
    const mm = macros || macrosOf(withFoods(items));
    return {
        meal: slot,
        saved_meal_id: savedMealId || null,
        signature: items.length ? mealSignature(savedMealId, items.map(it => it.food_id)) : `d:${slot}`,
        name: name || null,
        items: items.map(it => {
            const f = NUT.foodsById[it.food_id] || {};
            return { food_id: it.food_id, name_en: f.name_en || null, name_el: f.name_el || null, grams: Number(it.grams) };
        }),
        kcal: Math.round(mm.kcal), protein: round(mm.p, 1), carbs: round(mm.c, 1), fat: round(mm.f, 1),
    };
}

// Ask the database, not the page's copy: another tab may have changed it.
async function fetchLogs(dateIso, slot) {
    const { data, error } = await db.from('meal_log').select('*').eq('eaten_on', dateIso).eq('meal', slot);
    if (error) throw error;
    NUT.mealLog = NUT.mealLog.filter(l => !(l.eaten_on === dateIso && l.meal === slot)).concat(data || []);
    return data || [];
}

// Mark a day's meal as eaten (adds its calories to that day's tracker), or undo it.
// macros: totals for meals without food data (the built-in default plan).
// One toggle at a time: a quick double tap must not log the meal twice.
let eatToggleBusy = false;
async function toggleEaten(args) {
    if (eatToggleBusy) return;
    eatToggleBusy = true;
    try { await toggleEatenNow(args); } finally { eatToggleBusy = false; }
}

async function toggleEatenNow({ date, slot, savedMealId, name, items, macros = null }) {
    const day = formatDate(date);
    let logged;
    try { logged = await fetchLogs(date, slot); }
    catch (err) { showToast(t('common.error', { msg: err.message }), 'error'); return; }

    if (logged.length) {
        // Unmark: remove every entry for this slot (older double taps could leave two)
        // but take the meal's calories off only once — they were only added once.
        const ids = logged.map(l => l.log_id);
        const { error } = await db.from('meal_log').delete().in('log_id', ids);
        if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
        NUT.mealLog = NUT.mealLog.filter(l => !ids.includes(l.log_id));
        const kcal = Math.round(Number(logged[0].kcal) || 0);
        try {
            const total = await adjustCaloriesEaten(date, -kcal);
            showToast(t('meals.unmarked', { meal: t('meal.' + slot), kcal, day, total }));
        } catch (err) {
            showToast(t('meals.trackerError', { msg: err.message }), 'error');
        }
        return;
    }

    const row = { eaten_on: date, ...mealLogFields(slot, savedMealId, name, items, macros) };
    const { data, error } = await db.from('meal_log').insert([row]).select().single();
    if (error) { showToast(t('common.errorSaving', { msg: error.message }), 'error'); return; }
    NUT.mealLog.unshift(data);
    try {
        const total = await adjustCaloriesEaten(date, row.kcal);
        showToast(t('meals.marked', { meal: t('meal.' + slot), kcal: row.kcal, day, total }));
    } catch (err) {
        showToast(t('meals.trackerError', { msg: err.message }), 'error');
    }
}

// A meal that is already marked as eaten was edited, replaced or deleted:
// update its log entry and move that day's calories by the difference.
// Returns a short note for the toast, or '' when the meal wasn't eaten.
async function syncEatenMeal(date, slot, items, savedMealId) {
    if (!NUT.mealsReady) return '';
    const logged = await fetchLogs(date, slot);
    if (!logged.length) return '';
    const oldKcal = Math.round(Number(logged[0].kcal) || 0);
    const ids = logged.map(l => l.log_id);

    let newKcal = 0;
    if (items.length) {
        const saved = savedMealId && NUT.savedMeals.find(m => m.meal_id === savedMealId);
        const fields = mealLogFields(slot, savedMealId, saved ? saved.name : null, items);
        newKcal = fields.kcal;
        const { error } = await db.from('meal_log').update(fields).eq('log_id', ids[0]);
        if (error) throw error;
        if (ids.length > 1) await db.from('meal_log').delete().in('log_id', ids.slice(1));
    } else {
        const { error } = await db.from('meal_log').delete().in('log_id', ids);
        if (error) throw error;
    }
    await fetchLogs(date, slot);

    const delta = newKcal - oldKcal;
    if (!delta) return '';
    const total = await adjustCaloriesEaten(date, delta);
    return t('meals.eatenSynced', { day: formatDate(date), delta: (delta > 0 ? '+' : '−') + Math.abs(delta), total });
}

// ---- My Meals tab -------------------------------------------
function renderMealsTab() {
    document.getElementById('btn-new-meal').disabled = !NUT.mealsReady;
    const list = document.getElementById('saved-meals-list');
    if (!NUT.mealsReady) {
        list.innerHTML = `<div class="card empty"><div class="icon">🗄️</div><p>${escapeHtml(t('meals.dbMissing'))}</p></div>`;
        return;
    }
    if (!NUT.savedMeals.length) {
        list.innerHTML = `<div class="card empty"><div class="icon">🍽️</div><p>${escapeHtml(t('meals.empty'))}</p></div>`;
        return;
    }

    list.innerHTML = MEAL_ORDER.map(slot => {
        const meals = NUT.savedMeals.filter(m => m.meal_slot === slot)
            .sort((a, b) => a.name.localeCompare(b.name, LOCALE));
        if (!meals.length) return '';
        return `
            <div class="section-title">${escapeHtml(t('meal.' + slot))} <span class="muted text-sm">(${meals.length})</span></div>
            ${meals.map(savedMealCard).join('')}`;
    }).join('');
}

// Compact row (name, rating, macros); tapping it shows foods, rating controls and actions.
const openSavedMeals = new Set();   // meal_ids expanded — kept across re-renders

function savedMealCard(m) {
    const items = withFoods(m.items);
    const count = timesEaten(savedMealSignature(m));
    const open = openSavedMeals.has(m.meal_id);
    const rating = m.rating ? Number(m.rating) : null;
    return `
        <div class="card meal-card saved-meal ${open ? 'open' : ''}">
            <button type="button" class="saved-meal-head" data-act="toggle" data-id="${m.meal_id}"
                    aria-expanded="${open}" aria-controls="sm-body-${m.meal_id}">
                <span class="sm-name">${escapeHtml(m.name)}</span>
                ${rating ? `<span class="sm-rating" title="${escapeHtml(t('meals.rating'))}">★ ${rating}</span>` : ''}
                <span class="macro-pills">${macroPillsHtml(macrosOf(items))}</span>
                <span class="sm-chevron" aria-hidden="true">▾</span>
            </button>
            <div class="saved-meal-body" id="sm-body-${m.meal_id}" ${open ? '' : 'hidden'}>
            <ul class="meal-items">${items.map(it => `<li>${itemLabel(it)}</li>`).join('') || `<li class="muted">—</li>`}</ul>
            ${ratingRowHtml(m)}
            <div class="meal-actions">
                <span class="muted text-sm">${escapeHtml(count ? t('meals.timesEaten', { n: count }) : t('meals.neverEaten'))}</span>
                <span class="meal-icon-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-act="plan" data-id="${m.meal_id}">${escapeHtml(t('meals.addToPlan'))}</button>
                    <button type="button" class="pref-btn active" data-act="edit" data-id="${m.meal_id}" title="${escapeHtml(t('meals.edit'))}">✏️</button>
                    <button type="button" class="icon-btn" data-act="delete" data-id="${m.meal_id}" title="${escapeHtml(t('common.delete'))}">🗑</button>
                </span>
            </div>
            </div>
        </div>`;
}

async function onSavedMealClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const m = NUT.savedMeals.find(x => x.meal_id === Number(btn.dataset.id));
    if (!m) return;

    if (btn.dataset.act === 'toggle') {
        const open = !openSavedMeals.has(m.meal_id);
        if (open) openSavedMeals.add(m.meal_id); else openSavedMeals.delete(m.meal_id);
        btn.closest('.saved-meal').classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open);
        document.getElementById('sm-body-' + m.meal_id).hidden = !open;
        return;
    }

    if (btn.dataset.act === 'rate') await setMealRating(m, Number(btn.dataset.rating));
    if (btn.dataset.act === 'plan') openAddToPlan(m);
    if (btn.dataset.act === 'edit') {
        openMealEditor({ mode: 'saved', mealId: m.meal_id, name: m.name, slot: m.meal_slot, rating: m.rating, items: m.items });
    }
    if (btn.dataset.act === 'delete') {
        if (!(await confirmToast(t('meals.confirmDelete', { name: m.name }), { okText: t('common.delete') }))) return;
        const { error } = await db.from('saved_meals').delete().eq('meal_id', m.meal_id);
        if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
        NUT.savedMeals = NUT.savedMeals.filter(x => x.meal_id !== m.meal_id);
        renderMealsTab();
        if (NUT.plan) await reloadPlan();   // plan meals from it lose their ⭐ label
        showToast(t('meals.deleted'));
    }
}

// ---- Meal editor (modal) ------------------------------------
function foodOptionsHtml(selectedId) {
    return CATEGORY_ORDER.map(cat => {
        const foods = NUT.foods.filter(f => f.category === cat)
            .sort((a, b) => foodName(a).localeCompare(foodName(b), LOCALE));
        if (!foods.length) return '';
        return `<optgroup label="${escapeHtml(t('cat.' + cat))}">${foods.map(f => {
            const pref = NUT.prefs[f.food_id];
            const mark = pref === 'allergy' ? ' ⚠️' : pref === 'dislike' ? ' 👎' : pref === 'like' ? ' 👍' : '';
            return `<option value="${f.food_id}" ${String(f.food_id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(foodName(f))}${mark}</option>`;
        }).join('')}</optgroup>`;
    }).join('');
}

function addEditorRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'me-row';
    row.innerHTML = `
        <select class="me-food" required>
            <option value="">${escapeHtml(t('meals.pickFood'))}</option>
            ${foodOptionsHtml(item.food_id)}
        </select>
        <div class="me-grams"><input type="number" class="me-g" min="1" max="2000" step="1" required value="${item.grams ? round(item.grams) : ''}" placeholder="g"><span class="muted">g</span></div>
        <span class="me-kcal muted text-sm"></span>
        <button type="button" class="icon-btn me-remove" title="${escapeHtml(t('common.delete'))}">×</button>`;
    document.getElementById('me-items').appendChild(row);
}

function editorItems() {
    return [...document.querySelectorAll('#me-items .me-row')]
        .map(r => ({ food_id: Number(r.querySelector('.me-food').value), grams: Number(r.querySelector('.me-g').value) }))
        .filter(it => it.food_id && it.grams > 0);
}

function updateEditorTotals() {
    document.querySelectorAll('#me-items .me-row').forEach(r => {
        const f = NUT.foodsById[r.querySelector('.me-food').value];
        const g = Number(r.querySelector('.me-g').value);
        r.querySelector('.me-kcal').textContent = f && g ? `${round(Number(f.kcal) * g / 100)} kcal` : '';
    });
    document.getElementById('me-totals').innerHTML = macroPillsHtml(macrosOf(withFoods(editorItems())));
}

function openMealEditor(opts) {
    mealEditor = { ...opts };
    const isSaved = opts.mode === 'saved';
    document.getElementById('meal-modal-title').textContent = isSaved
        ? t(opts.mealId ? 'meals.editTitle' : 'meals.newTitle')
        : t('np.editPlanMealTitle', { meal: t('meal.' + opts.slot), day: dayLabelFull(selectedDayIdx) });

    document.getElementById('me-saved-fields').hidden = !isSaved;
    document.getElementById('me-name').required = isSaved;
    document.getElementById('me-name').value = opts.name || '';
    document.getElementById('me-slot').value = opts.slot || 'Lunch';
    document.getElementById('me-rating').value = opts.rating ? String(opts.rating) : '';

    // Plan mode: start from one of your meals (same meal type listed first).
    const fromSaved = document.getElementById('me-from-saved');
    document.getElementById('me-plan-fields').hidden = isSaved || !NUT.savedMeals.length;
    if (!isSaved) {
        const sorted = [...NUT.savedMeals].sort((a, b) =>
            (a.meal_slot === opts.slot ? 0 : 1) - (b.meal_slot === opts.slot ? 0 : 1) || a.name.localeCompare(b.name, LOCALE));
        fromSaved.innerHTML = `<option value="">${escapeHtml(t('np.fromSavedPh'))}</option>` +
            sorted.map(m => `<option value="${m.meal_id}">${escapeHtml(m.name)} · ${escapeHtml(t('meal.' + m.meal_slot))}</option>`).join('');
    }

    document.getElementById('me-items').innerHTML = '';
    (opts.items && opts.items.length ? opts.items : [{}]).forEach(addEditorRow);
    updateEditorTotals();
    document.getElementById('meal-modal').classList.add('show');
    (isSaved ? document.getElementById('me-name') : document.querySelector('.me-food')).focus();
}

function closeMealEditor() {
    document.getElementById('meal-modal').classList.remove('show');
    mealEditor = null;
}

function fillEditorFromSaved(e) {
    const m = NUT.savedMeals.find(x => x.meal_id === Number(e.target.value));
    if (!m) return;
    mealEditor.savedMealId = m.meal_id;
    document.getElementById('me-items').innerHTML = '';
    (m.items.length ? m.items : [{}]).forEach(addEditorRow);
    updateEditorTotals();
}

async function saveMealEditor(e) {
    e.preventDefault();
    if (!mealEditor) return;
    const items = editorItems();
    if (!items.length) { showToast(t('meals.needFood'), 'error'); return; }

    const btn = document.getElementById('me-save');
    btn.disabled = true;
    try {
        if (mealEditor.mode === 'plan') {
            // Still the saved meal only if its set of foods is unchanged (grams may differ).
            const saved = mealEditor.savedMealId && NUT.savedMeals.find(s => s.meal_id === mealEditor.savedMealId);
            const sameFoods = saved && mealSignature(null, saved.items.map(i => i.food_id)) === mealSignature(null, items.map(i => i.food_id));
            if (await savePlanMeal(mealEditor.slot, items, sameFoods ? saved.meal_id : null)) closeMealEditor();
            return;
        }

        const name = document.getElementById('me-name').value.trim();
        const slot = document.getElementById('me-slot').value;
        const parsed = parseRating(document.getElementById('me-rating').value);
        if (!parsed.ok) { showToast(t('meals.ratingInvalid'), 'error'); return; }
        const rating = parsed.rating;
        if (!name) return;
        let mealId = mealEditor.mealId;
        if (mealId) {
            const { error } = await db.from('saved_meals').update({ name, meal_slot: slot, rating }).eq('meal_id', mealId);
            if (error) throw error;
            const { error: dErr } = await db.from('saved_meal_items').delete().eq('meal_id', mealId);
            if (dErr) throw dErr;
        } else {
            const { data, error } = await db.from('saved_meals').insert([{ name, meal_slot: slot, rating }]).select().single();
            if (error) throw error;
            mealId = data.meal_id;
        }
        const { error: iErr } = await db.from('saved_meal_items')
            .insert(items.map((it, i) => ({ meal_id: mealId, food_id: it.food_id, grams: it.grams, sort_order: i })));
        if (iErr) throw iErr;

        const linkSlot = mealEditor.linkPlanSlot;
        const wasEdit = !!mealEditor.mealId;
        closeMealEditor();
        await loadMealsData();
        renderMealsTab();
        if (linkSlot && NUT.plan) await linkPlanMealToSaved(linkSlot, mealId);
        else if (NUT.plan) renderDay();
        showToast(t(wasEdit ? 'meals.updated' : 'meals.saved', { name }));
    } catch (err) {
        showToast(err.code === '23505' ? t('meals.duplicate') : mealSaveError(err), 'error');
    } finally {
        btn.disabled = false;
    }
}

// The rating column arrives with the updated meals_schema.sql.
function mealSaveError(err) {
    return /rating/i.test(err.message || '') ? t('meals.ratingDbMissing') : t('common.errorSaving', { msg: err.message });
}
