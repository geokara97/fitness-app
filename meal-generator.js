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

// Spread favourites over the week: { 'day|Meal': favourite }.
function scheduleFavourites(favourites, rng) {
    const schedule = {};
    const perSlot = {};
    [...favourites].sort((a, b) => b.count - a.count).forEach(fav => {
        const want = favouriteDays(fav.count);
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

        // Round portions, then emit in meal order.
        dayEntries.forEach(e => { e.grams = e.role === 'vegetables' ? e.grams : roundPortion(e.food, e.grams); });
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
 * Favourites from the meal log: meals eaten at least twice in the last
 * FAVOURITE_WEEKS weeks, per meal slot, most eaten first.
 * logs:       meal_log rows   savedMeals: [{ meal_id, items: [{ food_id, grams }] }]
 */
function favouritesFromLog(logs, savedMeals, todayIso) {
    const since = new Date(todayIso + 'T00:00:00');
    since.setDate(since.getDate() - FAVOURITE_WEEKS * 7);
    const pad = n => String(n).padStart(2, '0');
    const sinceIso = `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;   // local date, not UTC
    const savedById = Object.fromEntries(savedMeals.map(m => [m.meal_id, m]));

    const groups = {};
    logs.filter(l => l.eaten_on > sinceIso && l.eaten_on <= todayIso).forEach(l => {
        const key = `${l.meal}|${l.signature}`;
        const g = groups[key] || (groups[key] = { meal: l.meal, count: 0, latest: l });
        g.count++;
        if (l.eaten_on >= g.latest.eaten_on) g.latest = l;
    });

    return Object.values(groups)
        .filter(g => g.count >= 2)
        .map(g => {
            const saved = g.latest.saved_meal_id && savedById[g.latest.saved_meal_id];
            const items = saved
                ? saved.items.map(it => ({ food_id: it.food_id, grams: Number(it.grams) }))
                : (g.latest.items || []).map(it => ({ food_id: it.food_id, grams: Number(it.grams) }));
            return { meal: g.meal, count: g.count, savedMealId: saved ? saved.meal_id : null, name: g.latest.name, items };
        })
        .sort((a, b) => b.count - a.count);
}

// Node export for testing; ignored in the browser.
if (typeof module !== 'undefined') {
    module.exports = { generateMealPlan, MEAL_TEMPLATES, itemMacros, mealSignature, favouritesFromLog, favouriteDays };
}
