// ============================================================
// Nutrition: searchable food picker for the meal editor.
// Type to filter your foods; if one is missing, search USDA or
// Open Food Facts right there — the food is added to your foods,
// marked as liked and suitable for every meal.
// Uses NUT, foodName(), searchUsda(), searchOpenFoodFacts(),
// guessCategory() and macroLine() from the other nutrition files.
// ============================================================

const ALL_MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
const PREF_MARK = { like: ' 👍', dislike: ' 👎', allergy: ' ⚠️' };

document.addEventListener('DOMContentLoaded', () => {
    const items = document.getElementById('me-items');
    items.addEventListener('input', e => {
        const search = e.target.closest('.me-search');
        if (!search) return;
        const row = search.closest('.me-row');
        // Typing again means a new choice: forget the previous one.
        const chosen = NUT.foodsById[row.querySelector('.me-food').value];
        if (!chosen || foodName(chosen) !== search.value) row.querySelector('.me-food').value = '';
        row.onlineResults = null;
        renderPickerResults(row);
    });
    items.addEventListener('focusin', e => {
        const search = e.target.closest('.me-search');
        if (search) renderPickerResults(search.closest('.me-row'));
    });
    items.addEventListener('focusout', e => {
        const row = e.target.closest('.me-row');
        if (!row) return;
        // Close once focus has really left this row's picker.
        setTimeout(() => { if (!row.contains(document.activeElement)) closePicker(row); }, 0);
    });
    items.addEventListener('keydown', e => {
        const search = e.target.closest('.me-search');
        if (!search) return;
        const row = search.closest('.me-row');
        if (e.key === 'Escape' && !row.querySelector('.me-results').hidden) {
            e.stopPropagation();          // close the list, not the whole editor
            closePicker(row);
        } else if (e.key === 'Enter') {
            e.preventDefault();           // never submit the form from the search box
            row.querySelector('.me-opt')?.click();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            row.querySelector('.me-opt, .me-online-btn')?.focus();
        }
    });
    // pointerdown keeps focus in the row, so the list doesn't close before the click lands.
    items.addEventListener('pointerdown', e => { if (e.target.closest('.me-results')) e.preventDefault(); });
    items.addEventListener('click', onPickerClick);
});

// Markup for one row's picker: hidden id + search box + results list.
function foodPickerHtml(selectedId) {
    const food = NUT.foodsById[selectedId];
    return `
        <div class="me-pick">
            <input type="hidden" class="me-food" value="${food ? food.food_id : ''}">
            <input type="search" class="me-search" autocomplete="off" enterkeyhint="search"
                   placeholder="${escapeHtml(t('meals.searchFood'))}" value="${food ? escapeHtml(foodName(food)) : ''}">
            <div class="me-results" role="listbox" hidden></div>
        </div>`;
}

function closePicker(row) {
    const box = row.querySelector('.me-results');
    if (box) box.hidden = true;
}

function renderPickerResults(row) {
    const box = row.querySelector('.me-results');
    const q = row.querySelector('.me-search').value.trim();
    const needle = q.toLocaleLowerCase(LOCALE);

    // Your foods: names in both languages; liked first, then alphabetical.
    const rank = f => ({ like: 0, undefined: 1, dislike: 2, allergy: 3 })[NUT.prefs[f.food_id]] ?? 1;
    const local = NUT.foods
        .filter(f => !needle || `${f.name_en} ${f.name_el || ''}`.toLocaleLowerCase(LOCALE).includes(needle))
        .sort((a, b) => rank(a) - rank(b) || foodName(a).localeCompare(foodName(b), LOCALE))
        .slice(0, 8);

    let html = local.map(f => `
        <button type="button" class="me-opt" role="option" data-food="${f.food_id}">
            <span class="me-opt-name">${escapeHtml(foodName(f))}${PREF_MARK[NUT.prefs[f.food_id]] || ''}</span>
            <span class="me-opt-sub">${escapeHtml(t('cat.' + f.category))} · ${round(f.kcal)} kcal / 100 g</span>
        </button>`).join('');
    if (q && !local.length) html += `<p class="me-none">${escapeHtml(t('meals.notInFoods', { q }))}</p>`;

    // Online results (after a USDA / Open Food Facts search for this row)
    if (row.onlineResults === 'loading') {
        html += `<p class="me-none">${escapeHtml(t('foods.searching'))}</p>`;
    } else if (Array.isArray(row.onlineResults)) {
        html += `<div class="me-online-head">${escapeHtml(t('meals.onlineResults'))}</div>` + (row.onlineResults.length
            ? row.onlineResults.map((r, i) => `
                <button type="button" class="me-opt" role="option" data-ext="${i}">
                    <span class="me-opt-name">${escapeHtml(r.name_el && LANG === 'el' ? r.name_el : r.name_en)}
                        ${r.detail ? `<span class="muted">· ${escapeHtml(r.detail)}</span>` : ''}</span>
                    <span class="me-opt-sub">${escapeHtml(macroLine(r))} / 100 g</span>
                </button>`).join('')
            : `<p class="me-none">${escapeHtml(t('foods.noResults'))}</p>`);
    } else if (row.onlineError) {
        html += `<p class="me-none me-error">${escapeHtml(row.onlineError)}</p>`;
    }

    // Not there? Search online without leaving the meal.
    if (q.length >= 2) {
        html += `
            <div class="me-online">
                <button type="button" class="me-online-btn" data-src="usda">🔎 ${escapeHtml(t('meals.searchUsda'))}</button>
                <button type="button" class="me-online-btn" data-src="off">🔎 ${escapeHtml(t('meals.searchOff'))}</button>
            </div>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
}

async function onPickerClick(e) {
    const row = e.target.closest('.me-row');
    if (!row) return;

    const opt = e.target.closest('.me-opt');
    if (opt && opt.dataset.food) { selectPickerFood(row, NUT.foodsById[opt.dataset.food]); return; }

    if (opt && opt.dataset.ext !== undefined) {
        const r = row.onlineResults[Number(opt.dataset.ext)];
        opt.disabled = true;
        try {
            const food = await addFoodFromLookup(r);
            selectPickerFood(row, food);
            showToast(t('meals.foodAdded', { name: foodName(food) }), 'success');
        } catch (err) {
            opt.disabled = false;
            showToast(t('common.errorSaving', { msg: err.message }), 'error');
        }
        return;
    }

    const online = e.target.closest('.me-online-btn');
    if (online) {
        const q = row.querySelector('.me-search').value.trim();
        row.onlineError = null;
        row.onlineResults = 'loading';
        renderPickerResults(row);
        try {
            row.onlineResults = online.dataset.src === 'usda' ? await searchUsda(q) : await searchOpenFoodFacts(q);
        } catch (err) {
            row.onlineResults = null;
            row.onlineError = err.message;
        }
        renderPickerResults(row);
        row.querySelector('.me-search').focus();
    }
}

function selectPickerFood(row, food) {
    if (!food) return;
    row.querySelector('.me-food').value = food.food_id;
    row.querySelector('.me-search').value = foodName(food);
    row.onlineResults = null;
    closePicker(row);
    const grams = row.querySelector('.me-g');
    if (!grams.value) grams.value = Number(food.piece_grams) > 0 ? round(Number(food.piece_grams)) : 100;
    grams.focus();
    grams.select();
    updateEditorTotals();
}

// A food found online becomes one of your foods: liked and suitable for every meal.
async function addFoodFromLookup(r) {
    const row = {
        name_en: r.name_en.slice(0, 120),
        name_el: (r.name_el || '').slice(0, 120) || null,
        category: guessCategory(r.protein, r.carbs, r.fat),
        kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat,
        piece_grams: null,
        meal_slots: ALL_MEAL_SLOTS,
        is_custom: true,
        source: r.source,
        external_id: r.externalId || null,
    };
    let food;
    const { data, error } = await db.from('foods').insert([row]).select().single();
    if (error) {
        // Already in your foods under that name: use it.
        food = error.code === '23505'
            && NUT.foods.find(f => f.name_en.toLocaleLowerCase() === row.name_en.toLocaleLowerCase());
        if (!food) throw error;
    } else {
        food = data;
        NUT.foods.push(food);
        NUT.foodsById[food.food_id] = food;
    }
    await likeFoods([food.food_id]);
    return food;
}

// Foods you put in a meal are foods you eat: mark them liked.
async function likeFoods(ids) {
    const toLike = [...new Set(ids.map(Number))].filter(id => NUT.foodsById[id] && NUT.prefs[id] !== 'like');
    if (!toLike.length) return;
    const { error } = await db.from('food_preferences')
        .upsert(toLike.map(food_id => ({ food_id, preference: 'like' })), { onConflict: 'food_id' });
    if (error) { console.warn('Could not mark foods as liked:', error.message); return; }
    toLike.forEach(id => { NUT.prefs[id] = 'like'; });
    if (typeof renderFoodList === 'function') renderFoodList();
    if (typeof renderRotation === 'function') renderRotation();
}
