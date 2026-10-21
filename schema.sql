-- ============================================================
-- FitTrack Personal — Supabase / PostgreSQL schema
-- Matches the current app code (single user, no login).
--
-- Run once in the Supabase SQL Editor of a NEW or EMPTY project.
-- Uses plain CREATE TABLE on purpose: if an older table with the
-- same name exists (e.g. workouts), it fails loudly instead of
-- silently keeping an incompatible table.
-- ============================================================


-- ------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


-- ------------------------------------------------------------
-- profile — single config row (id is always 1)
-- Read by every page via loadProfile(); edited on Settings.
-- ------------------------------------------------------------
create table public.profile (
    id                      smallint primary key default 1 check (id = 1),
    name                    text,
    age                     integer      not null default 30 check (age between 10 and 100),
    gender                  text         not null default 'Male' check (gender in ('Male', 'Female')),
    height_cm               numeric(5,1) not null default 180 check (height_cm > 0),
    activity_level          text         not null default 'Sedentary (desk job)'
                            check (activity_level in ('Sedentary (desk job)', 'Lightly active',
                                                      'Moderately active', 'Very active')),

    -- Weight goal
    start_weight            numeric(5,2) not null default 90,
    current_weight          numeric(5,2) not null default 90,  -- synced from latest weight_log entry
    goal_weight             numeric(5,2) not null default 75,
    goal_date               date,

    -- Calorie-burn constants
    lifting_kcal_per_kg_min numeric(6,4) not null default 0.075,
    lifting_default_min     integer      not null default 60,
    walking_kcal_per_1000   numeric(6,2) not null default 45,   -- at the 90 kg baseline
    neat_multiplier         numeric(4,2) not null default 1.25,

    -- Nutrition targets
    daily_calorie_target    integer      not null default 1800,
    protein_target          integer      not null default 170,
    carbs_target            integer      not null default 145,
    fat_target              integer      not null default 55,

    created_at              timestamptz  not null default now(),
    updated_at              timestamptz  not null default now()
);

create trigger profile_updated_at
    before update on public.profile
    for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- weight_log — one weigh-in per date (upsert on log_date)
-- ------------------------------------------------------------
create table public.weight_log (
    weight_log_id bigint generated always as identity primary key,
    log_date      date         not null unique,
    weight        numeric(5,2) not null check (weight > 0),
    created_at    timestamptz  not null default now()
);


-- ------------------------------------------------------------
-- daily_log — one row per date (upsert on log_date)
-- Calories eaten, steps, sleep, water, notes. Burn is computed in the app.
-- ------------------------------------------------------------
create table public.daily_log (
    daily_log_id   bigint generated always as identity primary key,
    log_date       date         not null unique,
    calories_eaten integer      check (calories_eaten >= 0),
    steps          integer      check (steps >= 0),
    sleep_hours    numeric(4,1) check (sleep_hours between 0 and 24),
    water_liters   numeric(4,1) check (water_liters >= 0),
    notes          text,
    created_at     timestamptz  not null default now(),
    updated_at     timestamptz  not null default now()
);

create trigger daily_log_updated_at
    before update on public.daily_log
    for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- splits — training splits (Push, Pull, Legs, ...)
-- ------------------------------------------------------------
create table public.splits (
    split_id   bigint generated always as identity primary key,
    split_name text        not null unique,
    created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- exercises — exercise library, optionally tied to a split
-- (single FK to splits, so the embed splits(split_name) is unambiguous)
-- ------------------------------------------------------------
create table public.exercises (
    exercise_id   bigint generated always as identity primary key,
    exercise_name text        not null,
    split_id      bigint      references public.splits (split_id) on delete set null,
    is_active     boolean     not null default true,
    created_at    timestamptz not null default now(),
    unique (exercise_name, split_id)
);

create index exercises_split_id_idx on public.exercises (split_id);


-- ------------------------------------------------------------
-- workouts — one timed session
-- calories_burned = bodyweight × lifting_kcal_per_kg_min × minutes (computed in app)
-- ------------------------------------------------------------
create table public.workouts (
    workout_id       bigint generated always as identity primary key,
    workout_date     date         not null,
    split_id         bigint       references public.splits (split_id) on delete set null,
    duration_seconds integer      not null default 0 check (duration_seconds >= 0),
    bodyweight       numeric(5,2) check (bodyweight > 0),
    calories_burned  numeric(7,1) not null default 0 check (calories_burned >= 0),
    notes            text,
    created_at       timestamptz  not null default now()
);

create index workouts_workout_date_idx on public.workouts (workout_date);


-- ------------------------------------------------------------
-- workout_exercises — one row per SET of an exercise in a workout
-- Deleting a workout deletes its sets.
-- ------------------------------------------------------------
create table public.workout_exercises (
    workout_exercise_id bigint generated always as identity primary key,
    workout_id          bigint       not null references public.workouts (workout_id) on delete cascade,
    exercise_id         bigint       not null references public.exercises (exercise_id) on delete restrict,
    exercise_order      integer      not null default 1,
    set_number          integer      not null default 1,
    reps                integer      check (reps > 0),
    weight              numeric(6,2) check (weight >= 0),
    created_at          timestamptz  not null default now()
);

create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);
create index workout_exercises_exercise_id_idx on public.workout_exercises (exercise_id);


-- ============================================================
-- Row Level Security
-- The app connects with the public anon key and has no login,
-- so these policies give the anon role full access. Anyone who
-- has the key (it is in config.js) can read and write this data.
-- ============================================================
alter table public.profile           enable row level security;
alter table public.weight_log        enable row level security;
alter table public.daily_log         enable row level security;
alter table public.splits            enable row level security;
alter table public.exercises         enable row level security;
alter table public.workouts          enable row level security;
alter table public.workout_exercises enable row level security;

create policy "app full access" on public.profile           for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.weight_log        for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.daily_log         for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.splits            for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.exercises         for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.workouts          for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.workout_exercises for all to anon, authenticated using (true) with check (true);


-- ============================================================
-- Seed data
-- ============================================================

-- The single profile row (edit your real stats on the Settings page).
insert into public.profile (id) values (1);

-- Example splits and exercises (rename or add your own).
insert into public.splits (split_name) values
    ('Push'), ('Pull'), ('Legs'), ('Upper'), ('Lower');

insert into public.exercises (exercise_name, split_id)
select e.exercise_name, s.split_id
from (values
    ('Bench Press',            'Push'),
    ('Incline Dumbbell Press', 'Push'),
    ('Overhead Press',         'Push'),
    ('Lateral Raise',          'Push'),
    ('Triceps Pushdown',       'Push'),
    ('Deadlift',               'Pull'),
    ('Pull-Up',                'Pull'),
    ('Barbell Row',            'Pull'),
    ('Lat Pulldown',           'Pull'),
    ('Biceps Curl',            'Pull'),
    ('Back Squat',             'Legs'),
    ('Romanian Deadlift',      'Legs'),
    ('Leg Press',              'Legs'),
    ('Leg Curl',               'Legs'),
    ('Calf Raise',             'Legs'),
    ('Bench Press',            'Upper'),
    ('Barbell Row',            'Upper'),
    ('Overhead Press',         'Upper'),
    ('Pull-Up',                'Upper'),
    ('Back Squat',             'Lower'),
    ('Romanian Deadlift',      'Lower'),
    ('Walking Lunge',          'Lower'),
    ('Plank',                  'Lower')
) as e (exercise_name, split_name)
join public.splits s on s.split_name = e.split_name;
