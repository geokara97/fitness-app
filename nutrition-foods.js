// ============================================================
// Nutrition page — My Foods tab
// Like / dislike / allergy per food, and adding custom foods with
// macros looked up from USDA FoodData Central or Open Food Facts.
// Uses NUT, foodName() and renderRotation() from nutrition-page.js.
// ============================================================

const CATEGORY_ORDER = ['protein', 'carbs', 'fruit', 'vegetables', 'fats'];
const PREF_ICONS = { like: '👍', dislike: '👎', allergy: '⚠️' };

let lookupResults = [];

document.addEventListener('DOMContentLoaded', () => {
    ['food-search', 'food-filter-cat', 'food-filter-pref'].forEach(id =>
        document.getElementById(id).addEventListener('input', renderFoodList));
    document.getElementById('food-list').addEventListener('click', onFoodListClick);

    document.getElementById('btn-add-food').addEventListener('click', openFoodModal);
    document.getElementById('food-modal-close').addEventListener('click', closeFoodModal);
    document.getElementById('food-modal').addEventListener('click', e => {
        if (e.target.id === 'food-modal') closeFoodModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFoodModal(); });

    document.getElementById('btn-lookup').addEventListener('click', runLookup);
    document.getElementById('lookup-q').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); runLookup(); }
    });
    document.getElementById('lookup-results').addEventListener('click', onLookupPick);
    document.getElementById('food-form').addEventListener('submit', saveFood);
});

// Called by nutrition-page.js once data is loaded.
function renderFoodsTab() {
    document.getElementById('btn-add-food').disabled = !NUT.dbReady;
    renderFoodList();
}

// ---- List ---------------------------------------------------
function macroLine(f) {
    return `${round(f.kcal)} kcal · ${t('np.P')} ${round(f.protein, 1)} · ${t('np.C')} ${round(f.carbs, 1)} · ${t('np.F')} ${round(f.fat, 1)}`;
}

function renderPrefSummary() {
    const counts = { like: 0, dislike: 0, allergy: 0 };
    Object.values(NUT.prefs).forEach(p => { counts[p]++; });
    document.getElementById('pref-summary').innerHTML = `
        <span class="badge green">${PREF_ICONS.like} ${t('foods.countLiked', { n: counts.like })}</span>
        <span class="badge gray">${PREF_ICONS.dislike} ${t('foods.countDisliked', { n: counts.dislike })}</span>
        <span class="badge red">${PREF_ICONS.allergy} ${t('foods.countAllergy', { n: counts.allergy })}</span>`;
}

function renderFoodList() {
    renderPrefSummary();
    const list = document.getElementById('food-list');
    if (!NUT.dbReady) {
        list.innerHTML = `<div class="card empty"><div class="icon">🗄️</div><p>${escapeHtml(t('foods.dbMissing'))}</p></div>`;
        return;
    }

    const q = document.getElementById('food-search').value.trim().toLowerCase();
    const cat = document.getElementById('food-filter-cat').value;
    const pref = document.getElementById('food-filter-pref').value;

    const shown = NUT.foods.filter(f => {
        if (cat && f.category !== cat) return false;
        const p = NUT.prefs[f.food_id];
        if (pref === 'none' ? p : (pref && p !== pref)) return false;
        if (q && !`${f.name_en} ${f.name_el || ''}`.toLowerCase().includes(q)) return false;
        return true;
    });

    if (!shown.length) {
        list.innerHTML = `<div class="card empty"><div class="icon">🔍</div><p>${escapeHtml(t('foods.noMatch'))}</p></div>`;
        return;
    }

    list.innerHTML = CATEGORY_ORDER.map(c => {
        const group = shown.filter(f => f.category === c)
            .sort((a, b) => foodName(a).localeCompare(foodName(b), LOCALE));
        if (!group.length) return '';
        return `
            <div class="section-title">${escapeHtml(t('cat.' + c))} <span class="muted text-sm">(${group.length})</span></div>
            <div class="card food-group">${group.map(foodRow).join('')}</div>`;
    }).join('');
}

function foodRow(f) {
    const current = NUT.prefs[f.food_id];
    const btn = (p) => `
        <button type="button" class="pref-btn ${p} ${current === p ? 'active' : ''}"
                data-id="${f.food_id}" data-pref="${p}" title="${escapeHtml(t('foods.pref.' + p))}"
                aria-pressed="${current === p}">${PREF_ICONS[p]}</button>`;
    return `
        <div class="food-row">
            <div class="food-info">
                <strong>${escapeHtml(foodName(f))}</strong>
                ${f.is_custom ? `<span class="badge blue">${escapeHtml(t('foods.custom'))}</span>` : ''}
                <div class="muted text-sm">${macroLine(f)} <span class="per100">/ 100 g</span></div>
            </div>
            <div class="pref-btns">
                ${btn('like')}${btn('dislike')}${btn('allergy')}
                <button type="button" class="icon-btn" data-del="${f.food_id}" title="${escapeHtml(t('common.delete'))}">×</button>
            </div>
        </div>`;
}

async function onFoodListClick(e) {
    const prefBtn = e.target.closest('.pref-btn');
    if (prefBtn) return setPreference(Number(prefBtn.dataset.id), prefBtn.dataset.pref);
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) return deleteFood(Number(delBtn.dataset.del));
}

// Clicking the active preference again clears it.
async function setPreference(foodId, pref) {
    const before = NUT.prefs[foodId];
    const next = before === pref ? null : pref;
    if (next) NUT.prefs[foodId] = next; else delete NUT.prefs[foodId];
    renderFoodList();
    renderRotation();

    const { error } = next
        ? await db.from('food_preferences').upsert({ food_id: foodId, preference: next }, { onConflict: 'food_id' })
        : await db.from('food_preferences').delete().eq('food_id', foodId);
    if (error) {
        if (before) NUT.prefs[foodId] = before; else delete NUT.prefs[foodId];
        renderFoodList();
        renderRotation();
        showToast(t('common.errorSaving', { msg: error.message }), 'error');
    }
}

async function deleteFood(foodId) {
    const food = NUT.foodsById[foodId];
    if (!food || !confirm(t('foods.confirmDelete', { name: foodName(food) }))) return;
    const { error } = await db.from('foods').delete().eq('food_id', foodId);
    if (error) {
        showToast(error.code === '23503' ? t('foods.inUse') : t('common.error', { msg: error.message }), 'error');
        return;
    }
    NUT.foods = NUT.foods.filter(f => f.food_id !== foodId);
    delete NUT.foodsById[foodId];
    delete NUT.prefs[foodId];
    renderFoodList();
    renderRotation();
    showToast(t('foods.deleted'));
}

// ---- Add-food modal -----------------------------------------
function openFoodModal() {
    if (!NUT.dbReady) return;
    document.getElementById('food-form').reset();
    delete document.getElementById('food-form').dataset.source;
    delete document.getElementById('food-form').dataset.externalId;
    document.getElementById('ff-source-note').textContent = '';
    document.getElementById('lookup-results').innerHTML = '';
    lookupResults = [];
    document.getElementById('food-modal').classList.add('show');
    document.getElementById('lookup-q').focus();
}

function closeFoodModal() {
    document.getElementById('food-modal').classList.remove('show');
}

// ---- Online lookup ------------------------------------------
// Guess the food group from where most of the calories come from.
function guessCategory(p, c, f) {
    const kp = p * 4, kc = c * 4, kf = f * 9, total = kp + kc + kf || 1;
    if (kp / total >= 0.4) return 'protein';
    if (kf / total >= 0.6) return 'fats';
    return 'carbs';
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, round(n, 1)) : 0;
};

async function searchUsda(q) {
    const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?' + new URLSearchParams({
        api_key: USDA_API_KEY, query: q, dataType: 'Foundation,SR Legacy', pageSize: '15',
    });
    const res = await fetch(url);
    if (res.status === 429) throw new Error(t('foods.usdaLimit'));
    if (!res.ok) throw new Error(t('foods.lookupBusy'));
    const json = await res.json();
    return (json.foods || []).map(f => {
        const n = (id) => (f.foodNutrients || []).find(x => x.nutrientId === id)?.value;
        const p = num(n(1003)), c = num(n(1005)), fat = num(n(1004));
        // SR Legacy uses 1008; Foundation foods report Atwater energy (2047/2048).
        const kcal = num(n(1008) ?? n(2047) ?? n(2048) ?? (p * 4 + c * 4 + fat * 9));
        return { source: 'usda', externalId: String(f.fdcId), name_en: f.description, name_el: '',
                 detail: f.dataType, kcal, protein: p, carbs: c, fat };
    });
}

async function searchOpenFoodFacts(q) {
    const fields = 'code,product_name,product_name_en,product_name_el,brands,nutriments';
    const isBarcode = /^\d{8,14}$/.test(q);
    const url = isBarcode
        ? `https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${fields}`
        : 'https://world.openfoodfacts.org/cgi/search.pl?' + new URLSearchParams({
            search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: '15', fields,
        });
    let res;
    try { res = await fetch(url); }
    catch (e) { throw new Error(t('foods.lookupBusy')); }   // OFF error pages lack CORS headers
    if (isBarcode && res.status === 404) return [];
    if (!res.ok) throw new Error(t('foods.lookupBusy'));
    const json = await res.json();
    const products = isBarcode ? (json.product ? [json.product] : []) : (json.products || []);
    return products
        .filter(p => p.nutriments && (p.nutriments['energy-kcal_100g'] != null || p.nutriments.energy_100g != null))
        .map(p => {
            const n = p.nutriments;
            const kcal = n['energy-kcal_100g'] ?? (n.energy_100g / 4.184);
            return {
                source: 'openfoodfacts', externalId: p.code,
                name_en: p.product_name_en || p.product_name || p.product_name_el || p.code,
                name_el: p.product_name_el || '',
                detail: p.brands || '',
                kcal: num(kcal), protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g),
            };
        });
}

async function runLookup() {
    const q = document.getElementById('lookup-q').value.trim();
    const box = document.getElementById('lookup-results');
    if (!q) return;
    const btn = document.getElementById('btn-lookup');
    btn.disabled = true;
    box.innerHTML = `<p class="muted text-sm">${escapeHtml(t('foods.searching'))}</p>`;
    try {
        const source = document.getElementById('lookup-source').value;
        lookupResults = source === 'usda' ? await searchUsda(q) : await searchOpenFoodFacts(q);
        box.innerHTML = lookupResults.length
            ? lookupResults.map((r, i) => `
                <button type="button" class="lookup-item" data-i="${i}">
                    <strong>${escapeHtml(r.name_el && LANG === 'el' ? r.name_el : r.name_en)}</strong>
                    ${r.detail ? `<span class="muted text-sm"> · ${escapeHtml(r.detail)}</span>` : ''}
                    <div class="muted text-sm">${macroLine(r)} / 100 g</div>
                </button>`).join('')
            : `<p class="muted text-sm">${escapeHtml(t('foods.noResults'))}</p>`;
    } catch (err) {
        lookupResults = [];
        box.innerHTML = `<p class="text-sm" style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
    } finally {
        btn.disabled = false;
    }
}

function onLookupPick(e) {
    const item = e.target.closest('.lookup-item');
    if (!item) return;
    const r = lookupResults[Number(item.dataset.i)];
    if (!r) return;

    document.querySelectorAll('.lookup-item').forEach(el => el.classList.toggle('selected', el === item));
    document.getElementById('ff-name-en').value = r.name_en.slice(0, 120);
    document.getElementById('ff-name-el').value = (r.name_el || '').slice(0, 120);
    document.getElementById('ff-category').value = guessCategory(r.protein, r.carbs, r.fat);
    document.getElementById('ff-kcal').value = r.kcal;
    document.getElementById('ff-protein').value = r.protein;
    document.getElementById('ff-carbs').value = r.carbs;
    document.getElementById('ff-fat').value = r.fat;

    const form = document.getElementById('food-form');
    form.dataset.source = r.source;
    form.dataset.externalId = r.externalId;
    document.getElementById('ff-source-note').textContent =
        t(r.source === 'usda' ? 'foods.fromUsda' : 'foods.fromOff', { id: r.externalId });
    document.getElementById('ff-name-en').focus();
}

// ---- Save ---------------------------------------------------
async function saveFood(e) {
    e.preventDefault();
    const form = e.target;
    const slots = [...document.querySelectorAll('input[name="ff-slot"]:checked')].map(c => c.value);
    if (!slots.length) { showToast(t('foods.needSlot'), 'error'); return; }

    const piece = document.getElementById('ff-piece').value;
    const row = {
        name_en: document.getElementById('ff-name-en').value.trim(),
        name_el: document.getElementById('ff-name-el').value.trim() || null,
        category: document.getElementById('ff-category').value,
        kcal: Number(document.getElementById('ff-kcal').value),
        protein: Number(document.getElementById('ff-protein').value),
        carbs: Number(document.getElementById('ff-carbs').value),
        fat: Number(document.getElementById('ff-fat').value),
        piece_grams: piece ? Number(piece) : null,
        meal_slots: slots,
        is_custom: true,
        source: form.dataset.source || 'custom',
        external_id: form.dataset.externalId || null,
    };
    if (!row.name_en) return;

    const btn = document.getElementById('ff-save');
    btn.disabled = true;
    try {
        const { data: food, error } = await db.from('foods').insert([row]).select().single();
        if (error) throw error;
        // A food you add yourself is one you want to eat — mark it liked.
        const { error: pErr } = await db.from('food_preferences')
            .upsert({ food_id: food.food_id, preference: 'like' }, { onConflict: 'food_id' });
        if (!pErr) NUT.prefs[food.food_id] = 'like';

        NUT.foods.push(food);
        NUT.foodsById[food.food_id] = food;
        closeFoodModal();
        renderFoodList();
        renderRotation();
        showToast(t('foods.added', { name: foodName(food) }));
    } catch (err) {
        showToast(err.code === '23505' ? t('foods.duplicate') : t('common.errorSaving', { msg: err.message }), 'error');
    } finally {
        btn.disabled = false;
    }
}
