// ============================================================
// Meal plan generator — builds a 7-day plan from the user's foods
// so each day lands close to the calorie & macro targets.
// Pure logic: no DB or DOM access.
// ============================================================

// Share of the daily targets per meal, and which food groups each meal uses.
const MEAL_TEMPLATES = [
    { meal: 'Breakfast', slot: 'breakfast', share: 0.27, parts: ['protein', 'carbs', 'fats'] },
    { meal: 'Lunch',     slot: 'lunch',     share: 0.30, parts: ['protein', 'carbs', 'fats'], vegGrams: 200 },
    { meal: 'Snack',     slot: 'snack',     share: 0.13, parts: ['protein', 'fruit', 'fats'] },
    { meal: 'Dinner',    slot: 'dinner',    share: 0.30, parts: ['protein', 'carbs', 'fats'], vegGrams: 200 },
];

// Macro errors are weighted by kcal² per gram (protein 4, carbs 4, fat 9),
// so the solver minimises the calorie impact of missing each target.
const MACRO_WEIGHTS = [16, 16, 81];

// Per-gram macro vector [protein, carbs, fat].
function macroVec(food) {
    return [Number(food.protein) / 100, Number(food.carbs) / 100, Number(food.fat) / 100];
}

// Sensible portion limits in grams, scaled by how dense the food is.
function portionBounds(food, role) {
    const kcal = Number(food.kcal) || 1;
    switch (role) {
        // ≤ 55 g protein and ≤ 20 g fat from one protein portion (caps eggs, salmon…)
        // and protein powders at 50 g (about 1½ scoops)
        case 'protein': return { min: Number(food.protein) > 50 ? 20 : 40,
                                 max: Math.min(Number(food.protein) > 50 ? 50 : 400,
                                               5500 / Math.max(Number(food.protein), 1),
                                               2000 / Math.max(Number(food.fat), 0.1)) };
        case 'carbs':   return { min: 20, max: Math.min(600, 45000 / kcal) };
        case 'fruit':   return { min: 80, max: 300 };
        // oils 5–15 g, nuts 10–30 g, olives/avocado/feta up to 80 g
        case 'fats':    return { min: Number(food.fat) > 80 ? 5 : 10,
                                 max: Math.min(80, 1500 / Math.max(Number(food.fat), 1)) };
        default:        return { min: 0,  max: 300 };
    }
}

// Round to whole pieces (eggs, fruit, slices) or to 5 g.
function roundPortion(food, grams) {
    const piece = Number(food.piece_grams);
    if (piece > 0) return Math.max(1, Math.round(grams / piece)) * piece;
    return Math.max(5, Math.round(grams / 5) * 5);
}

function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Foods usable for a group + meal slot: liked first; if none are liked,
// fall back to unmarked foods. Disliked & allergy foods are never used.
function buildPools(foods, prefs) {
    const pools = {};
    const fallbacks = new Set();
    for (const tpl of MEAL_TEMPLATES) {
        for (const role of [...tpl.parts, 'vegetables']) {
            const key = `${role}|${tpl.slot}`;
            const fits = foods.filter(f => f.category === role && (f.meal_slots || []).includes(tpl.slot));
            const liked = fits.filter(f => prefs[f.food_id] === 'like');
            const neutral = fits.filter(f => !prefs[f.food_id]);
            if (liked.length) {
                pools[key] = liked;
            } else {
                pools[key] = neutral;
                if (neutral.length) fallbacks.add(role);
            }
        }
    }
    return { pools, fallbacks: [...fallbacks] };
}

// Solve grams for one meal so its protein/carbs/fat approach the target:
// bounded weighted least squares, by coordinate descent over the foods.
function solveMeal(parts, target, fixed) {
    const x = parts.map(() => 0);
    for (let iter = 0; iter < 60; iter++) {
        parts.forEach((part, i) => {
            let num = 0, den = 0;
            for (let k = 0; k < 3; k++) {
                let others = fixed[k];
                parts.forEach((o, j) => { if (j !== i) others += o.vec[k] * x[j]; });
                num += MACRO_WEIGHTS[k] * part.vec[k] * (target[k] - others);
                den += MACRO_WEIGHTS[k] * part.vec[k] * part.vec[k];
            }
            x[i] = den > 0 ? Math.min(part.bounds.max, Math.max(0, num / den)) : 0;
        });
    }
    return parts.map((part, i) => {
        let g = x[i];
        if (g < part.bounds.min) g = part.role === 'fats' ? 0 : part.bounds.min;   // tiny fat portions are dropped
        return g;
    });
}

function itemMacros(food, grams) {
    const r = grams / 100;
    return {
        kcal: Number(food.kcal) * r,
        p: Number(food.protein) * r,
        c: Number(food.carbs) * r,
        f: Number(food.fat) * r,
    };
}

function sumMacros(entries) {
    return entries.reduce((s, e) => {
        const m = itemMacros(e.food, e.grams);
        s.kcal += m.kcal; s.p += m.p; s.c += m.c; s.f += m.f;
        return s;
    }, { kcal: 0, p: 0, c: 0, f: 0 });
}

// Pick the dayIdx-th food from a pool, skipping ones in `avoid`.
function pick(pool, dayIdx, offset, avoid) {
    if (!pool || !pool.length) return null;
    for (let n = 0; n < pool.length; n++) {
        const f = pool[(dayIdx + offset + n) % pool.length];
        if (!avoid.has(f.food_id)) return f;
    }
    return pool[(dayIdx + offset) % pool.length];
}

// ---- Favourite meals -----------------------------------------
// Days per week for a favourite eaten `count` times in the last 4 weeks:
// 2–5× → 1 day, 6–9× → 2 days, 10+× → 3 days.
const FAVOURITE_WEEKS = 4;
const MAX_FAVOURITE_DAYS_PER_SLOT = 4;   // keep at least 3 days of variety per meal slot

function favouriteDays(count) {
    return Math.max(1, Math.min(3, Math.round(count / FAVOURITE_WEEKS)));
}

// Days per week from your 1–10 rating: 9–10 → 3, 7–8 → 2, 5–6 → 1, otherwise 0.
function ratingDays(rating) {
    if (!rating) return 0;
    return rating >= 9 ? 3 : rating >= 7 ? 2 : rating >= 5 ? 1 : 0;
}

// Spread favourites over the week: { 'day|Meal': favourite }.
function scheduleFavourites(favourites, rng) {
    const schedule = {};
    const perSlot = {};
    const daysOf = fav => fav.days || favouriteDays(fav.count);
    [...favourites].sort((a, b) => daysOf(b) - daysOf(a) || (b.count || 0) - (a.count || 0)).forEach(fav => {
        const want = daysOf(fav);
        const start = Math.floor(rng() * 7);
        const step = 7 / want;
        for (let k = 0; k < want; k++) {
            if ((perSlot[fav.meal] || 0) >= MAX_FAVOURITE_DAYS_PER_SLOT) break;
            // Preferred evenly-spaced day, else the next free one.
            for (let n = 0; n < 7; n++) {
                const d = (Math.round(start + k * step) + n) % 7;
                const key = `${d}|${fav.meal}`;
                if (schedule[key]) continue;
                schedule[key] = fav;
                perSlot[fav.meal] = (perSlot[fav.meal] || 0) + 1;
                break;
            }
        }
    });
    return schedule;
}

// Whole-day corrections shared by generating and re-fitting:
// protein top-up, calorie correction on carbs, then rounding.
function finishDay(dayEntries, targets) {
    // Daily protein top-up: spread any shortfall over protein portions that still have room.
    const proteinEntries = dayEntries.filter(e => e.role === 'protein');
    for (let pass = 0; pass < 4 && proteinEntries.length; pass++) {
        const short = targets.protein - sumMacros(dayEntries).p;
        if (short < 3) break;
        const open = proteinEntries.filter(e => e.grams < portionBounds(e.food, e.role).max - 1);
        if (!open.length) break;
        open.forEach(e => {
            const b = portionBounds(e.food, e.role);
            e.grams = Math.min(b.max, e.grams + (short / open.length) / (Number(e.food.protein) / 100));
        });
    }

    // Daily calorie correction: nudge carb portions toward the kcal target.
    const carbEntries = dayEntries.filter(e => e.role === 'carbs' || e.role === 'fruit');
    for (let pass = 0; pass < 3 && carbEntries.length; pass++) {
        const diff = targets.kcal - sumMacros(dayEntries).kcal;
        if (Math.abs(diff) < 25) break;
        const share = diff / carbEntries.length;
        carbEntries.forEach(e => {
            const b = portionBounds(e.food, e.role);
            const perG = Number(e.food.kcal) / 100 || 1;
            e.grams = Math.min(b.max, Math.max(b.min, e.grams + share / perG));
        });
    }

    dayEntries.forEach(e => { e.grams = e.role === 'vegetables' ? e.grams : roundPortion(e.food, e.grams); });
}

/**
 * Re-fit an existing plan to new daily targets: same foods and meals, new portions.
 * rows:     [{ day_of_week, meal, food_id, grams, sort_order, saved_meal_id }]
 * Saved (favourite) meals keep their recipe and are scaled as a whole (±30%);
 * vegetables keep their grams; every other food is re-solved like a fresh plan.
 * Extra meals the user logged on a day (not one of the four) are kept exactly
 * as they are and don't change how the other meals are fitted.
 * Returns rows in the same shape with new grams.
 */
function refitMealPlan(rows, foodById, targets) {
    const out = [];
    const basic = new Set(MEAL_TEMPLATES.map(tpl => tpl.meal));
    for (let d = 1; d <= 7; d++) {
        const extras = rows.filter(r => r.day_of_week === d && !basic.has(r.meal) && foodById[r.food_id]);
        const dayEntries = [];
        MEAL_TEMPLATES.forEach(tpl => {
            const mealRows = rows
                .filter(r => r.day_of_week === d && r.meal === tpl.meal && foodById[r.food_id])
                .sort((a, b) => a.sort_order - b.sort_order);
            if (!mealRows.length) return;
            const entries = mealRows.map(r => {
                const food = foodById[r.food_id];
                return { food, grams: Number(r.grams), meal: tpl.meal, order: r.sort_order,
                         savedMealId: r.saved_meal_id || null,
                         role: ['protein', 'carbs', 'fruit', 'fats', 'vegetables'].includes(food.category) ? food.category : 'carbs' };
            });

            if (entries.some(e => e.savedMealId)) {
                const kcal = sumMacros(entries).kcal;
                const factor = kcal > 0 ? Math.min(1.3, Math.max(0.7, (targets.kcal * tpl.share) / kcal)) : 1;
                entries.forEach(e => { e.grams *= factor; e.role = 'fixed'; });
            } else {
                const fixed = [0, 0, 0];
                entries.filter(e => e.role === 'vegetables')
                    .forEach(e => macroVec(e.food).forEach((m, k) => { fixed[k] += m * e.grams; }));
                const parts = entries.filter(e => e.role !== 'vegetables')
                    .map(e => ({ entry: e, role: e.role, vec: macroVec(e.food), bounds: portionBounds(e.food, e.role) }));
                const target = [targets.protein * tpl.share, targets.carbs * tpl.share, targets.fat * tpl.share];
                const grams = solveMeal(parts, target, fixed);
                // Keep every food the user sees in the plan: never solve one away.
                parts.forEach((part, i) => { part.entry.grams = grams[i] > 0 ? grams[i] : part.bounds.min; });
            }
            dayEntries.push(...entries);
        });

        finishDay(dayEntries, targets);
        dayEntries.forEach(e => out.push({
            day_of_week: d, meal: e.meal, food_id: e.food.food_id, grams: e.grams,
            sort_order: e.order, saved_meal_id: e.savedMealId,
        }));
        extras.forEach(r => out.push({
            day_of_week: d, meal: r.meal, food_id: r.food_id, grams: Number(r.grams),
            sort_order: r.sort_order, saved_meal_id: r.saved_meal_id || null,
        }));
    }
    return out;
}

/**
 * foods:      rows from `foods`
 * prefs:      { [food_id]: 'like' | 'dislike' | 'allergy' }
 * targets:    { kcal, protein, carbs, fat }  (daily)
 * favourites: [{ meal, count, savedMealId, items: [{ food_id, grams }] }] — meals the user
 *             ate often; placed first, portions scaled to the meal's calorie share.
 * Returns { items: [{ day_of_week, meal, food_id, grams, sort_order, saved_meal_id }],
 *           fallbacks, missing, favouritesPlaced }
 */
function generateMealPlan(foods, prefs, targets, rng = Math.random, favourites = []) {
    const { pools: rawPools, fallbacks } = buildPools(foods, prefs);
    const pools = {};
    for (const [k, v] of Object.entries(rawPools)) pools[k] = shuffle(v, rng);

    // Only favourites whose foods all still exist and are allowed.
    const foodById = Object.fromEntries(foods.map(f => [f.food_id, f]));
    const usableFavourites = favourites.filter(fav => fav.items.length && fav.items.every(it =>
        foodById[it.food_id] && prefs[it.food_id] !== 'dislike' && prefs[it.food_id] !== 'allergy'));
    const schedule = scheduleFavourites(usableFavourites, rng);

    const missing = new Set();
    const items = [];
    let favouritesPlaced = 0;

    for (let d = 0; d < 7; d++) {
        const dayEntries = [];          // { food, grams, role, meal, savedMealId }
        const usedToday = new Set();

        MEAL_TEMPLATES.forEach((tpl, mi) => {
            const target = [targets.protein * tpl.share, targets.carbs * tpl.share, targets.fat * tpl.share];
            const mealEntries = [];

            // A favourite meal takes this slot: keep its foods, scale portions
            // (within ±30%) toward this meal's calorie share.
            const fav = schedule[`${d}|${tpl.meal}`];
            if (fav) {
                const favEntries = fav.items.map((it, i) => ({
                    food: foodById[it.food_id], grams: Number(it.grams), role: 'fixed', order: i,
                    meal: tpl.meal, savedMealId: fav.savedMealId || null,
                }));
                const kcal = sumMacros(favEntries).kcal;
                const factor = kcal > 0 ? Math.min(1.3, Math.max(0.7, (targets.kcal * tpl.share) / kcal)) : 1;
                favEntries.forEach(e => { e.grams *= factor; usedToday.add(e.food.food_id); });
                dayEntries.push(...favEntries);
                favouritesPlaced++;
                return;
            }

            // Fixed vegetables (2 kinds when available).
            const fixed = [0, 0, 0];
            if (tpl.vegGrams) {
                const vegPool = pools[`vegetables|${tpl.slot}`];
                if (vegPool && vegPool.length) {
                    const kinds = vegPool.length > 1 ? 2 : 1;
                    const avoid = new Set();
                    for (let v = 0; v < kinds; v++) {
                        const veg = pick(vegPool, d * 2 + v, mi, avoid);
                        avoid.add(veg.food_id);
                        const grams = tpl.vegGrams / kinds;
                        macroVec(veg).forEach((m, k) => { fixed[k] += m * grams; });
                        mealEntries.push({ food: veg, grams, role: 'vegetables' });
                    }
                } else {
                    missing.add('vegetables');
                }
            }

            // Main foods.
            const parts = [];
            tpl.parts.forEach(role => {
                const food = pick(pools[`${role}|${tpl.slot}`], d, mi, usedToday);
                if (!food) { if (role !== 'fats') missing.add(role); return; }
                usedToday.add(food.food_id);
                parts.push({ food, role, vec: macroVec(food), bounds: portionBounds(food, role) });
            });

            const grams = solveMeal(parts, target, fixed);
            parts.forEach((part, i) => {
                if (grams[i] <= 0) return;
                mealEntries.unshift({ food: part.food, grams: grams[i], role: part.role });
            });

            mealEntries.forEach(e => { e.meal = tpl.meal; });
            dayEntries.push(...mealEntries);
        });

        finishDay(dayEntries, targets);

        // Emit in meal order.
        const order = { protein: 0, carbs: 1, fruit: 1, fats: 2, vegetables: 3 };
        const rank = e => e.role === 'fixed' ? e.order : order[e.role];
        MEAL_TEMPLATES.forEach(tpl => {
            dayEntries
                .filter(e => e.meal === tpl.meal)
                .sort((a, b) => rank(a) - rank(b))
                .forEach((e, i) => items.push({
                    day_of_week: d + 1,
                    meal: tpl.meal,
                    food_id: e.food.food_id,
                    grams: e.grams,
                    sort_order: i,
                    saved_meal_id: e.savedMealId || null,
                }));
        });
    }

    return { items, fallbacks, missing: [...missing], favouritesPlaced };
}

// Same meal, same key: a saved meal by id, anything else by its set of foods.
function mealSignature(savedMealId, foodIds) {
    return savedMealId ? `s:${savedMealId}` : `f:${[...new Set(foodIds.map(Number))].sort((a, b) => a - b).join(',')}`;
}

/**
 * Favourites for the generator, each with the number of days per week it gets:
 *  - meals eaten at least twice in the last FAVOURITE_WEEKS weeks (favouriteDays)
 *  - saved meals rated 5+ (ratingDays)
 * A saved meal gets the higher of the two. Rated 1–3 = never auto-added.
 * logs:       meal_log rows
 * savedMeals: [{ meal_id, name, meal_slot, rating, items: [{ food_id, grams }] }]
 */
function favouritesFromLog(logs, savedMeals, todayIso) {
    const since = new Date(todayIso + 'T00:00:00');
    since.setDate(since.getDate() - FAVOURITE_WEEKS * 7);
    const pad = n => String(n).padStart(2, '0');
    const sinceIso = `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;   // local date, not UTC
    const savedById = Object.fromEntries(savedMeals.map(m => [m.meal_id, m]));
    const itemsOf = list => (list || []).map(it => ({ food_id: it.food_id, grams: Number(it.grams) }));

    // Count recent eats: saved meals by id, everything else by slot + food set.
    const savedCounts = {};
    const groups = {};
    logs.filter(l => l.eaten_on > sinceIso && l.eaten_on <= todayIso).forEach(l => {
        if (l.saved_meal_id && savedById[l.saved_meal_id]) {
            savedCounts[l.saved_meal_id] = (savedCounts[l.saved_meal_id] || 0) + 1;
            return;
        }
        const key = `${l.meal}|${l.signature}`;
        const g = groups[key] || (groups[key] = { meal: l.meal, count: 0, latest: l });
        g.count++;
        if (l.eaten_on >= g.latest.eaten_on) g.latest = l;
    });

    const fromSaved = savedMeals.map(m => {
        const count = savedCounts[m.meal_id] || 0;
        const rating = m.rating ? Number(m.rating) : null;
        const days = rating !== null && rating <= 3
            ? 0
            : Math.max(ratingDays(rating), count >= 2 ? favouriteDays(count) : 0);
        return { meal: m.meal_slot, count, rating, days, savedMealId: m.meal_id, name: m.name, items: itemsOf(m.items) };
    });

    const fromLog = Object.values(groups)
        .filter(g => g.count >= 2)
        .map(g => ({ meal: g.meal, count: g.count, rating: null, days: favouriteDays(g.count),
                     savedMealId: null, name: g.latest.name, items: itemsOf(g.latest.items) }));

    return [...fromSaved, ...fromLog]
        .filter(f => f.days > 0 && f.items.length)
        .sort((a, b) => b.days - a.days || b.count - a.count);
}

// Node export for testing; ignored in the browser.
if (typeof module !== 'undefined') {
    module.exports = { generateMealPlan, MEAL_TEMPLATES, itemMacros, mealSignature, favouritesFromLog, favouriteDays, ratingDays };
}
