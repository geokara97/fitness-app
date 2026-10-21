// ============================================================
// Nutrition page — My Meals tab, the meal editor (shared with the
// plan) and the "I ate this today" meal log.
// Uses NUT, foodName(), macrosOf(), itemLabel(), savePlanMeal(),
// linkPlanMealToSaved() and renderDay() from nutrition-page.js.
// ============================================================

let mealEditor = null;   // { mode: 'saved' | 'plan', mealId, slot, savedMealId, linkPlanSlot }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-new-meal').addEventListener('click', () =>
        openMealEditor({ mode: 'saved', slot: 'Lunch', items: [] }));
    document.getElementById('saved-meals-list').addEventListener('click', onSavedMealClick);

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
});

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
function findTodayLog(slot, signature) {
    const today = todayISO();
    return NUT.mealLog.find(l => l.eaten_on === today && l.meal === slot && l.signature === signature);
}

// Times eaten (any slot) in the favourites window.
function timesEaten(signature) {
    const since = isoDaysAgo(FAVOURITE_WEEKS * 7 - 1);
    return NUT.mealLog.filter(l => l.signature === signature && l.eaten_on >= since).length;
}

// Mark a meal as eaten today, or undo it if it already is.
async function toggleEatenToday({ slot, savedMealId, name, items }) {
    const signature = mealSignature(savedMealId, items.map(it => it.food_id));
    const existing = findTodayLog(slot, signature);
    if (existing) {
        const { error } = await db.from('meal_log').delete().eq('log_id', existing.log_id);
        if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
        NUT.mealLog = NUT.mealLog.filter(l => l.log_id !== existing.log_id);
        showToast(t('meals.unlogged'));
        return;
    }
    const mm = macrosOf(withFoods(items));
    const row = {
        eaten_on: todayISO(), meal: slot, saved_meal_id: savedMealId || null, signature, name: name || null,
        items: items.map(it => {
            const f = NUT.foodsById[it.food_id] || {};
            return { food_id: it.food_id, name_en: f.name_en || null, name_el: f.name_el || null, grams: Number(it.grams) };
        }),
        kcal: round(mm.kcal, 1), protein: round(mm.p, 1), carbs: round(mm.c, 1), fat: round(mm.f, 1),
    };
    const { data, error } = await db.from('meal_log').insert([row]).select().single();
    if (error) { showToast(t('common.errorSaving', { msg: error.message }), 'error'); return; }
    NUT.mealLog.unshift(data);
    showToast(t('meals.logged', { meal: t('meal.' + slot) }));
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

function savedMealCard(m) {
    const items = withFoods(m.items);
    const sig = savedMealSignature(m);
    const eaten = !!findTodayLog(m.meal_slot, sig);
    const count = timesEaten(sig);
    return `
        <div class="card meal-card">
            <div class="meal-head">
                <h4>${escapeHtml(m.name)}</h4>
                <div class="macro-pills">${macroPillsHtml(macrosOf(items))}</div>
            </div>
            <ul class="meal-items">${items.map(it => `<li>${itemLabel(it)}</li>`).join('') || `<li class="muted">—</li>`}</ul>
            <div class="meal-actions">
                <button type="button" class="btn btn-sm eat-btn ${eaten ? 'eaten' : ''}" data-act="eat" data-id="${m.meal_id}"
                        aria-pressed="${eaten}">${escapeHtml(t(eaten ? 'meals.eatenToday' : 'meals.ateToday'))}</button>
                <span class="muted text-sm">${escapeHtml(count ? t('meals.timesEaten', { n: count }) : t('meals.neverEaten'))}</span>
                <span class="meal-icon-actions">
                    <button type="button" class="pref-btn active" data-act="edit" data-id="${m.meal_id}" title="${escapeHtml(t('meals.edit'))}">✏️</button>
                    <button type="button" class="icon-btn" data-act="delete" data-id="${m.meal_id}" title="${escapeHtml(t('common.delete'))}">🗑</button>
                </span>
            </div>
        </div>`;
}

async function onSavedMealClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const m = NUT.savedMeals.find(x => x.meal_id === Number(btn.dataset.id));
    if (!m) return;

    if (btn.dataset.act === 'eat') {
        await toggleEatenToday({ slot: m.meal_slot, savedMealId: m.meal_id, name: m.name, items: m.items });
        renderMealsTab();
        if (NUT.plan) renderDay();
    }
    if (btn.dataset.act === 'edit') {
        openMealEditor({ mode: 'saved', mealId: m.meal_id, name: m.name, slot: m.meal_slot, items: m.items });
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
        : t('np.editPlanMealTitle', { meal: t('meal.' + opts.slot), day: t('day.' + planDay().day) });

    document.getElementById('me-saved-fields').hidden = !isSaved;
    document.getElementById('me-name').required = isSaved;
    document.getElementById('me-name').value = opts.name || '';
    document.getElementById('me-slot').value = opts.slot || 'Lunch';

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
        if (!name) return;
        let mealId = mealEditor.mealId;
        if (mealId) {
            const { error } = await db.from('saved_meals').update({ name, meal_slot: slot }).eq('meal_id', mealId);
            if (error) throw error;
            const { error: dErr } = await db.from('saved_meal_items').delete().eq('meal_id', mealId);
            if (dErr) throw dErr;
        } else {
            const { data, error } = await db.from('saved_meals').insert([{ name, meal_slot: slot }]).select().single();
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
        showToast(err.code === '23505' ? t('meals.duplicate') : t('common.errorSaving', { msg: err.message }), 'error');
    } finally {
        btn.disabled = false;
    }
}
