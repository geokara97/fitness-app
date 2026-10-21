// ============================================================
// Nutrition: Shopping tab — everything the week's plan needs,
// added up per food, like a supermarket list.
// Uses the week shown on the Meal Plan tab (NUT.weekStart).
// ============================================================

let shopRange = 'week';            // 'week' | 'rest' (today onwards) | 'day' (one chosen day)
let shopDayIdx = null;             // 0 = Monday … 6 = Sunday, for 'day'
let shopDayWeek = null;            // the week shopDayIdx was picked in

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#shop-range .main-tab').forEach(tab => tab.addEventListener('click', () => {
        shopRange = tab.dataset.range;
        document.querySelectorAll('#shop-range .main-tab').forEach(t2 => t2.classList.toggle('active', t2 === tab));
        renderShoppingList();
    }));
    document.getElementById('shop-prev').addEventListener('click', () => changeWeek(-1));
    document.getElementById('shop-next').addEventListener('click', () => changeWeek(1));
    document.getElementById('shop-list').addEventListener('change', onShopTick);
    document.getElementById('shop-days').addEventListener('click', e => {
        const tab = e.target.closest('.day-tab');
        if (!tab) return;
        shopDayIdx = Number(tab.dataset.i);
        renderShoppingList();
    });
    document.getElementById('shop-share').addEventListener('click', shareShoppingList);
    document.getElementById('shop-clear').addEventListener('click', () => {
        saveTicks(new Set());
        renderShoppingList();
    });
    if (typeof attachTabIndicator === 'function') attachTabIndicator(document.getElementById('shop-range'), '.main-tab');
});

// ---- Ticks (kept per week in this browser) -----------------
function ticksKey() { return 'fittrack-shopping-' + NUT.weekStart; }
function loadTicks() {
    try { return new Set(JSON.parse(localStorage.getItem(ticksKey()) || '[]')); } catch { return new Set(); }
}
function saveTicks(set) {
    try { localStorage.setItem(ticksKey(), JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

function onShopTick(e) {
    const box = e.target.closest('input[type="checkbox"][data-food]');
    if (!box) return;
    const ticks = loadTicks();
    if (box.checked) ticks.add(box.dataset.food); else ticks.delete(box.dataset.food);
    saveTicks(ticks);
    box.closest('.shop-item').classList.toggle('done', box.checked);
    renderShopCount();
}

// ---- Totals -------------------------------------------------
// [{ food, grams }] for the plan's basic meals. Logged extra meals were
// already eaten, so they are not on the list.
function shoppingTotals() {
    if (!NUT.plan) return [];
    const today = todayISO();
    const byFood = new Map();
    NUT.plan.rows.forEach(r => {
        const food = NUT.foodsById[r.food_id];
        if (!food || isExtraMeal(r.meal)) return;
        const date = dateOfDay(r.day_of_week - 1);
        if (shopRange === 'rest' && date < today) return;
        if (shopRange === 'day' && r.day_of_week !== shopDayIdx + 1) return;
        byFood.set(food.food_id, (byFood.get(food.food_id) || 0) + Number(r.grams));
    });
    return [...byFood].map(([id, grams]) => ({ food: NUT.foodsById[id], grams }));
}

// "1.25 kg", "450 g", or for foods counted in pieces "6 pcs · 360 g".
function shopAmount(food, grams) {
    const piece = Number(food.piece_grams);
    const weight = grams >= 1000 ? `${round(grams / 1000, 2)} kg` : `${Math.ceil(grams / 10) * 10} g`;
    if (piece > 0) return `${Math.ceil(grams / piece)} ${t('shop.pcs')} · ${weight}`;
    return weight;
}

// ---- Day strip ("By day") -----------------------------------
// Starts on today in the current week, Monday in other weeks; kept while you stay in the week.
function renderShopDays() {
    const strip = document.getElementById('shop-days');
    strip.hidden = shopRange !== 'day';
    if (shopDayWeek !== NUT.weekStart || shopDayIdx === null) {
        shopDayWeek = NUT.weekStart;
        shopDayIdx = weeksFromNow(NUT.weekStart) === 0 ? dayIndexOf(todayISO()) : 0;
    }
    if (strip.hidden) return;
    const today = todayISO();
    strip.innerHTML = DAY_NAMES.map((d, i) => {
        const iso = dateOfDay(i);
        return `<div class="day-tab ${i === shopDayIdx ? 'active' : ''} ${iso === today ? 'today' : ''}" data-i="${i}">
                    <span>${t('dayShort.' + d)}</span> <strong>${new Date(iso + 'T00:00:00').getDate()}</strong></div>`;
    }).join('');
}

// ---- Render -------------------------------------------------
function renderShoppingList() {
    const list = document.getElementById('shop-list');
    if (!list) return;
    document.getElementById('shop-week').textContent = weekLabel(NUT.weekStart);
    renderShopDays();
    const n = weeksFromNow(NUT.weekStart);
    document.getElementById('shop-prev').disabled = n <= -WEEKS_BACK;
    document.getElementById('shop-next').disabled = n >= WEEKS_AHEAD;

    if (!NUT.plan) {
        list.innerHTML = `<div class="card empty"><div class="icon">🛒</div><p>${escapeHtml(t('shop.noPlan'))}</p></div>`;
        renderShopCount();
        return;
    }
    const totals = shoppingTotals();
    if (!totals.length) {
        const msg = shopRange === 'day' ? t('shop.nothingDay') : t('shop.nothingLeft');
        list.innerHTML = `<div class="card empty"><div class="icon">✅</div><p>${escapeHtml(msg)}</p></div>`;
        renderShopCount();
        return;
    }

    const ticks = loadTicks();
    list.innerHTML = CATEGORY_ORDER.map(cat => {
        const group = totals.filter(x => x.food.category === cat)
            .sort((a, b) => foodName(a.food).localeCompare(foodName(b.food), LOCALE));
        if (!group.length) return '';
        return `
            <div class="section-title">${escapeHtml(t('cat.' + cat))} <span class="muted text-sm">(${group.length})</span></div>
            <div class="list-group shop-group">
                ${group.map(({ food, grams }) => {
                    const done = ticks.has(String(food.food_id));
                    return `
                    <label class="shop-item ${done ? 'done' : ''}">
                        <input type="checkbox" data-food="${food.food_id}" ${done ? 'checked' : ''}>
                        <span class="shop-name">${escapeHtml(foodName(food))}</span>
                        <span class="shop-qty">${escapeHtml(shopAmount(food, grams))}</span>
                    </label>`;
                }).join('')}
            </div>`;
    }).join('');
    renderShopCount();
}

function renderShopCount() {
    const boxes = [...document.querySelectorAll('#shop-list input[data-food]')];
    const done = boxes.filter(b => b.checked).length;
    document.getElementById('shop-count').textContent = boxes.length
        ? t('shop.count', { n: boxes.length, done }) : '';
    document.getElementById('shop-clear').hidden = !done;
    document.getElementById('shop-share').hidden = !boxes.length;
}

// ---- Share / copy -------------------------------------------
async function shareShoppingList() {
    const ticks = loadTicks();
    const totals = shoppingTotals();
    const when = shopRange === 'day' ? dayLabelFull(shopDayIdx) : weekLabel(NUT.weekStart);
    const lines = [`🛒 ${t('shop.title')} — ${when}`];
    CATEGORY_ORDER.forEach(cat => {
        const group = totals.filter(x => x.food.category === cat && !ticks.has(String(x.food.food_id)))
            .sort((a, b) => foodName(a.food).localeCompare(foodName(b.food), LOCALE));
        if (!group.length) return;
        lines.push('', t('cat.' + cat));
        group.forEach(({ food, grams }) => lines.push(`• ${foodName(food)} — ${shopAmount(food, grams)}`));
    });
    const text = lines.join('\n');
    try {
        if (navigator.share) { await navigator.share({ title: t('shop.title'), text }); return; }
        await navigator.clipboard.writeText(text);
        showToast(t('shop.copied'), 'success');
    } catch (err) {
        if (err && err.name === 'AbortError') return;   // share sheet closed
        showToast(t('common.error', { msg: err.message }), 'error');
    }
}
