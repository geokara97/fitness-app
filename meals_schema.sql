-- ============================================================
-- FitTrack Personal — saved meals & meal log
-- Run in the Supabase SQL Editor AFTER nutrition_schema.sql (safe to re-run).
--
--   saved_meals / saved_meal_items : your own meals (foods + grams, optional 1–10 rating, e.g. 7.5)
--   meal_log                       : meals you marked as eaten — the plan
--                                    generator favours the ones you eat most
--   meal_plan_items.saved_meal_id  : which plan meals came from a saved meal
--   meal_plans.week_start          : plans belong to calendar weeks (Monday)
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

-- Your 1–10 rating, one decimal allowed (e.g. 7.5): higher-rated meals appear on more
-- days of generated plans (9+ → ~3 days/week, 7+ → 2, 5+ → 1; 3 or less keeps it out).
alter table public.saved_meals
    add column if not exists rating numeric(3,1) check (rating between 1 and 10);
-- Earlier versions stored whole numbers only; widen to one decimal.
alter table public.saved_meals alter column rating type numeric(3,1);

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
-- Plans per calendar week: one plan per week, starting on Monday.
-- meal_plan_items.day_of_week (1 = Monday) + week_start give the real date.
-- Existing plans move to the week they were created in (newest wins).
-- ------------------------------------------------------------
alter table public.meal_plans add column if not exists week_start date;

delete from public.meal_plans p
using public.meal_plans q
where p.week_start is null and q.week_start is null
  and date_trunc('week', p.created_at) = date_trunc('week', q.created_at)
  and p.plan_id < q.plan_id;

update public.meal_plans
set week_start = date_trunc('week', created_at)::date      -- ISO weeks start on Monday
where week_start is null;

alter table public.meal_plans alter column week_start set not null;
create unique index if not exists meal_plans_week_unique on public.meal_plans (week_start);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'meal_plans_week_is_monday') then
        alter table public.meal_plans
            add constraint meal_plans_week_is_monday check (extract(isodow from week_start) = 1);
    end if;
end $$;


-- ------------------------------------------------------------
-- Extra meals: a plan day (and the meal log) can hold meals besides
-- Breakfast / Lunch / Snack / Dinner, named by the user ("Pre-workout").
-- The fixed list is replaced by a length check. Saved meals keep the four types.
-- ------------------------------------------------------------
alter table public.meal_plan_items drop constraint if exists meal_plan_items_meal_check;
alter table public.meal_log        drop constraint if exists meal_log_meal_check;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'meal_plan_items_meal_name_check') then
        alter table public.meal_plan_items
            add constraint meal_plan_items_meal_name_check check (char_length(btrim(meal)) between 1 and 40);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'meal_log_meal_name_check') then
        alter table public.meal_log
            add constraint meal_log_meal_name_check check (char_length(btrim(meal)) between 1 and 40);
    end if;
end $$;


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
