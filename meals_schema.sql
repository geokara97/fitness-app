-- ============================================================
-- FitTrack Personal — saved meals & meal log
-- Run in the Supabase SQL Editor AFTER nutrition_schema.sql (safe to re-run).
--
--   saved_meals / saved_meal_items : your own meals (foods + grams, optional 1–10 rating)
--   meal_log                       : meals you marked as eaten — the plan
--                                    generator favours the ones you eat most
--   meal_plan_items.saved_meal_id  : which plan meals came from a saved meal
-- ============================================================

begin;

-- ------------------------------------------------------------
-- saved_meals — a named meal for one meal slot
-- ------------------------------------------------------------
create table if not exists public.saved_meals (
    meal_id    bigint generated always as identity primary key,
    name       text        not null check (length(trim(name)) > 0),
    meal_slot  text        not null check (meal_slot in ('Breakfast', 'Lunch', 'Snack', 'Dinner')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index if not exists saved_meals_name_unique on public.saved_meals (lower(name));

-- Your 1–10 rating: higher-rated meals appear on more days of generated plans
-- (9–10 → ~3 days/week, 7–8 → 2, 5–6 → 1; 1–3 keeps the meal out of generated plans).
alter table public.saved_meals
    add column if not exists rating smallint check (rating between 1 and 10);

drop trigger if exists saved_meals_updated_at on public.saved_meals;
create trigger saved_meals_updated_at
    before update on public.saved_meals
    for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- saved_meal_items — foods (with raw grams) in a saved meal
-- ------------------------------------------------------------
create table if not exists public.saved_meal_items (
    item_id    bigint generated always as identity primary key,
    meal_id    bigint       not null references public.saved_meals (meal_id) on delete cascade,
    food_id    bigint       not null references public.foods (food_id) on delete restrict,
    grams      numeric(6,1) not null check (grams > 0),
    sort_order smallint     not null default 0
);
create index if not exists saved_meal_items_meal_idx on public.saved_meal_items (meal_id);
create index if not exists saved_meal_items_food_idx on public.saved_meal_items (food_id);


-- ------------------------------------------------------------
-- meal_log — "I ate this" records
-- signature groups repeats of the same meal:
--   's:<meal_id>'         for a saved meal
--   'f:<food ids sorted>' for any other combination (e.g. a generated meal)
-- items is a snapshot, so the log survives later edits/deletes.
-- ------------------------------------------------------------
create table if not exists public.meal_log (
    log_id        bigint generated always as identity primary key,
    eaten_on      date         not null default current_date,
    meal          text         not null check (meal in ('Breakfast', 'Lunch', 'Snack', 'Dinner')),
    saved_meal_id bigint       references public.saved_meals (meal_id) on delete set null,
    signature     text         not null,
    name          text,
    items         jsonb        not null default '[]'::jsonb,   -- [{ food_id, name_en, name_el, grams }]
    kcal          numeric(7,1) not null default 0,
    protein       numeric(6,1) not null default 0,
    carbs         numeric(6,1) not null default 0,
    fat           numeric(6,1) not null default 0,
    created_at    timestamptz  not null default now()
);
create index if not exists meal_log_eaten_on_idx  on public.meal_log (eaten_on);
create index if not exists meal_log_signature_idx on public.meal_log (signature);


-- ------------------------------------------------------------
-- Link generated-plan meals to the saved meal they came from
-- ------------------------------------------------------------
alter table public.meal_plan_items
    add column if not exists saved_meal_id bigint references public.saved_meals (meal_id) on delete set null;


-- ------------------------------------------------------------
-- Row Level Security (same open policy as the other tables)
-- ------------------------------------------------------------
alter table public.saved_meals      enable row level security;
alter table public.saved_meal_items enable row level security;
alter table public.meal_log         enable row level security;

drop policy if exists "app full access" on public.saved_meals;
drop policy if exists "app full access" on public.saved_meal_items;
drop policy if exists "app full access" on public.meal_log;
create policy "app full access" on public.saved_meals      for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.saved_meal_items for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.meal_log         for all to anon, authenticated using (true) with check (true);

commit;
