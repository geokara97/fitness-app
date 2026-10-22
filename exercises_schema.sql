-- ============================================================
-- Metron — exercises & splits upgrade
-- Run in the Supabase SQL Editor AFTER schema.sql (safe to re-run).
--
-- What it changes:
--   * an exercise can belong to several splits   (new table exercise_splits)
--   * a workout can cover several splits          (new table workout_splits)
--   * Greek names for splits & exercises, user-added exercises
--   * a larger exercise library (~75 exercises, 13 splits incl. Biceps & Triceps)
-- Existing workouts and sets are kept. Duplicate exercises from the old
-- one-split-per-exercise design (e.g. "Bench Press" under Push and Upper)
-- are merged into one exercise linked to both splits.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. New columns & link tables
-- ------------------------------------------------------------
alter table public.splits
    add column if not exists split_name_el text,
    add column if not exists sort_order    smallint not null default 100;

alter table public.exercises
    add column if not exists exercise_name_el text,
    add column if not exists is_custom        boolean not null default false;

-- Timed exercises (plank, wall sit…) are logged in seconds instead of reps.
alter table public.exercises
    add column if not exists measure text not null default 'reps';
alter table public.workout_exercises
    add column if not exists duration_seconds integer;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'exercises_measure_check') then
        alter table public.exercises add constraint exercises_measure_check check (measure in ('reps', 'time'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'workout_exercises_duration_check') then
        alter table public.workout_exercises
            add constraint workout_exercises_duration_check check (duration_seconds is null or duration_seconds > 0);
    end if;
end $$;

create table if not exists public.exercise_splits (
    exercise_id bigint not null references public.exercises (exercise_id) on delete cascade,
    split_id    bigint not null references public.splits (split_id) on delete cascade,
    primary key (exercise_id, split_id)
);
create index if not exists exercise_splits_split_idx on public.exercise_splits (split_id);

create table if not exists public.workout_splits (
    workout_id bigint not null references public.workouts (workout_id) on delete cascade,
    split_id   bigint not null references public.splits (split_id) on delete cascade,
    primary key (workout_id, split_id)
);
create index if not exists workout_splits_split_idx on public.workout_splits (split_id);

alter table public.exercise_splits enable row level security;
alter table public.workout_splits  enable row level security;
drop policy if exists "app full access" on public.exercise_splits;
drop policy if exists "app full access" on public.workout_splits;
create policy "app full access" on public.exercise_splits for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.workout_splits  for all to anon, authenticated using (true) with check (true);


-- ------------------------------------------------------------
-- 2. Move the old single-split columns into the link tables
-- ------------------------------------------------------------
do $$
begin
    -- exercises.split_id -> exercise_splits
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'exercises' and column_name = 'split_id') then
        insert into public.exercise_splits (exercise_id, split_id)
        select exercise_id, split_id from public.exercises where split_id is not null
        on conflict do nothing;
        alter table public.exercises drop column split_id;   -- also drops unique (exercise_name, split_id)
    end if;

    -- workouts.split_id -> workout_splits
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'workouts' and column_name = 'split_id') then
        insert into public.workout_splits (workout_id, split_id)
        select workout_id, split_id from public.workouts where split_id is not null
        on conflict do nothing;
        alter table public.workouts drop column split_id;
    end if;
end $$;


-- ------------------------------------------------------------
-- 3. Merge duplicate exercises (same name, different case/split)
-- ------------------------------------------------------------
create temp table exercise_merge on commit drop as
select exercise_id,
       first_value(exercise_id) over (partition by lower(trim(exercise_name)) order by exercise_id) as keep_id
from public.exercises;
delete from exercise_merge where exercise_id = keep_id;

insert into public.exercise_splits (exercise_id, split_id)
select m.keep_id, es.split_id
from exercise_merge m join public.exercise_splits es on es.exercise_id = m.exercise_id
on conflict do nothing;

update public.workout_exercises we
set exercise_id = m.keep_id
from exercise_merge m
where we.exercise_id = m.exercise_id;

delete from public.exercises where exercise_id in (select exercise_id from exercise_merge);

-- One exercise per name from now on (case-insensitive).
create unique index if not exists exercises_name_unique on public.exercises (lower(exercise_name));

-- Old seed names -> names used by the new library (only if the new name is free).
update public.exercises e set exercise_name = v.new_name
from (values ('Biceps Curl', 'Dumbbell Curl'),
             ('Leg Curl',    'Lying Leg Curl'),
             ('Calf Raise',  'Standing Calf Raise')) as v (old_name, new_name)
where e.exercise_name = v.old_name
  and not exists (select 1 from public.exercises x where lower(x.exercise_name) = lower(v.new_name));


-- ------------------------------------------------------------
-- 4. Splits (English + Greek, display order)
-- ------------------------------------------------------------
insert into public.splits (split_name, split_name_el, sort_order) values
    ('Push',      'Push (ώθηση)',  1),
    ('Pull',      'Pull (έλξη)',   2),
    ('Legs',      'Πόδια',         3),
    ('Upper',     'Άνω σώμα',      4),
    ('Lower',     'Κάτω σώμα',     5),
    ('Full Body', 'Ολόσωμη',       6),
    ('Chest',     'Στήθος',        7),
    ('Back',      'Πλάτη',         8),
    ('Shoulders', 'Ώμοι',          9),
    ('Biceps',    'Δικέφαλοι',    11),
    ('Triceps',   'Τρικέφαλοι',   12),
    ('Core',      'Κοιλιακοί',    13)
on conflict (split_name) do update
    set split_name_el = excluded.split_name_el,
        sort_order    = excluded.sort_order;


-- ------------------------------------------------------------
-- 5. Exercise library: name, Greek name, splits it belongs to
-- ------------------------------------------------------------
create temp table exercise_seed (name_en text, name_el text, split_names text[]) on commit drop;
insert into exercise_seed values
-- Chest
('Bench Press',                    'Πιέσεις πάγκου με μπάρα',              '{Push,Upper,Chest,Full Body}'),
('Incline Bench Press',            'Πιέσεις σε κεκλιμένο πάγκο με μπάρα',  '{Push,Upper,Chest}'),
('Dumbbell Bench Press',           'Πιέσεις πάγκου με αλτήρες',            '{Push,Upper,Chest}'),
('Incline Dumbbell Press',         'Πιέσεις σε κεκλιμένο με αλτήρες',      '{Push,Upper,Chest}'),
('Decline Bench Press',            'Πιέσεις σε αρνητικό πάγκο',            '{Push,Chest}'),
('Chest Press Machine',            'Πιέσεις στήθους σε μηχάνημα',          '{Push,Chest}'),
('Dumbbell Fly',                   'Ανοίγματα με αλτήρες',                 '{Push,Chest}'),
('Cable Crossover',                'Χιαστί σε τροχαλία',                   '{Push,Chest}'),
('Pec Deck',                       'Πεταλούδα (pec deck)',                 '{Push,Chest}'),
('Push-Up',                        'Κάμψεις (push-ups)',                   '{Push,Upper,Chest,Full Body}'),
('Chest Dip',                      'Βυθίσεις για στήθος',                  '{Push,Chest}'),
-- Shoulders
('Overhead Press',                 'Πιέσεις ώμων όρθιος με μπάρα',         '{Push,Upper,Shoulders,Full Body}'),
('Seated Dumbbell Shoulder Press', 'Πιέσεις ώμων καθιστός με αλτήρες',     '{Push,Upper,Shoulders}'),
('Arnold Press',                   'Arnold press',                         '{Push,Shoulders}'),
('Shoulder Press Machine',         'Πιέσεις ώμων σε μηχάνημα',             '{Push,Shoulders}'),
('Lateral Raise',                  'Πλάγιες εκτάσεις',                     '{Push,Upper,Shoulders}'),
('Cable Lateral Raise',            'Πλάγιες εκτάσεις σε τροχαλία',         '{Push,Shoulders}'),
('Front Raise',                    'Εμπρός εκτάσεις',                      '{Push,Shoulders}'),
('Rear Delt Fly',                  'Ανοίγματα οπίσθιων δελτοειδών',        '{Pull,Shoulders}'),
('Face Pull',                      'Face pull σε τροχαλία',                '{Pull,Upper,Shoulders}'),
('Upright Row',                    'Όρθια κωπηλατική',                     '{Shoulders}'),
-- Triceps
('Triceps Pushdown',               'Εκτάσεις τρικεφάλων σε τροχαλία',      '{Push,Triceps}'),
('Overhead Triceps Extension',     'Εκτάσεις τρικεφάλων πάνω από το κεφάλι', '{Push,Triceps}'),
('Skull Crusher',                  'Γαλλικές πιέσεις',                     '{Push,Triceps}'),
('Close-Grip Bench Press',         'Πιέσεις πάγκου με κλειστή λαβή',       '{Push,Triceps}'),
('Triceps Dip',                    'Βυθίσεις για τρικέφαλους',             '{Push,Triceps}'),
('Triceps Kickback',               'Εκτάσεις τρικεφάλων με αλτήρα (kickback)', '{Push,Triceps}'),
-- Back
('Deadlift',                       'Άρσεις θανάτου',                       '{Pull,Back,Lower,Full Body}'),
('Pull-Up',                        'Έλξεις μονόζυγου',                     '{Pull,Upper,Back,Full Body}'),
('Chin-Up',                        'Έλξεις με υπτιαλαβή',                  '{Pull,Back,Biceps}'),
('Lat Pulldown',                   'Έλξεις τροχαλίας εμπρός',              '{Pull,Upper,Back}'),
('Barbell Row',                    'Κωπηλατική με μπάρα',                  '{Pull,Upper,Back,Full Body}'),
('Dumbbell Row',                   'Κωπηλατική με αλτήρα',                 '{Pull,Upper,Back}'),
('Seated Cable Row',               'Κωπηλατική καθιστός σε τροχαλία',      '{Pull,Upper,Back}'),
('T-Bar Row',                      'Κωπηλατική T-bar',                     '{Pull,Back}'),
('Chest-Supported Row',            'Κωπηλατική με στήριξη στήθους',        '{Pull,Back}'),
('Straight-Arm Pulldown',          'Έλξεις τροχαλίας με τεντωμένα χέρια',  '{Pull,Back}'),
('Shrugs',                         'Ανασηκώσεις ώμων (shrugs)',            '{Pull,Back}'),
('Back Extension',                 'Εκτάσεις οσφύος',                      '{Pull,Back,Lower}'),
-- Biceps
('Barbell Curl',                   'Κάμψεις δικεφάλων με μπάρα',           '{Pull,Biceps}'),
('Dumbbell Curl',                  'Κάμψεις δικεφάλων με αλτήρες',         '{Pull,Upper,Biceps}'),
('Hammer Curl',                    'Κάμψεις σφυριού',                      '{Pull,Biceps}'),
('Preacher Curl',                  'Κάμψεις σε πάγκο Scott',               '{Pull,Biceps}'),
('Cable Curl',                     'Κάμψεις δικεφάλων σε τροχαλία',        '{Pull,Biceps}'),
('Incline Dumbbell Curl',          'Κάμψεις δικεφάλων σε κεκλιμένο πάγκο', '{Pull,Biceps}'),
('Concentration Curl',             'Κάμψεις συγκέντρωσης',                 '{Pull,Biceps}'),
-- Legs
('Back Squat',                     'Καθίσματα με μπάρα',                   '{Legs,Lower,Full Body}'),
('Front Squat',                    'Εμπρόσθια καθίσματα',                  '{Legs,Lower}'),
('Goblet Squat',                   'Καθίσματα goblet',                     '{Legs,Lower,Full Body}'),
('Hack Squat',                     'Hack squat',                           '{Legs,Lower}'),
('Leg Press',                      'Πρέσα ποδιών',                         '{Legs,Lower}'),
('Bulgarian Split Squat',          'Βουλγάρικα καθίσματα',                 '{Legs,Lower}'),
('Walking Lunge',                  'Προβολές με βάδισμα',                  '{Legs,Lower,Full Body}'),
('Step-Up',                        'Ανεβάσματα σε πάγκο',                  '{Legs,Lower}'),
('Romanian Deadlift',              'Ρουμάνικες άρσεις θανάτου',            '{Legs,Lower}'),
('Leg Extension',                  'Εκτάσεις ποδιών',                      '{Legs,Lower}'),
('Lying Leg Curl',                 'Κάμψεις ποδιών πρηνηδόν',              '{Legs,Lower}'),
('Seated Leg Curl',                'Κάμψεις ποδιών καθιστός',              '{Legs,Lower}'),
('Hip Thrust',                     'Hip thrust',                           '{Legs,Lower}'),
('Glute Bridge',                   'Γέφυρα γλουτών',                       '{Legs,Lower}'),
('Hip Abduction Machine',          'Απαγωγοί σε μηχάνημα',                 '{Legs,Lower}'),
('Hip Adduction Machine',          'Προσαγωγοί σε μηχάνημα',               '{Legs,Lower}'),
('Standing Calf Raise',            'Άνοδοι γαμπών όρθιος',                 '{Legs,Lower}'),
('Seated Calf Raise',              'Άνοδοι γαμπών καθιστός',               '{Legs,Lower}'),
('Kettlebell Swing',               'Αιωρήσεις kettlebell',                 '{Lower,Full Body}'),
-- Core
('Crunch',                         'Κοιλιακοί (crunches)',                 '{Core}'),
('Cable Crunch',                   'Κοιλιακοί σε τροχαλία',                '{Core}'),
('Bicycle Crunch',                 'Κοιλιακοί ποδήλατο',                   '{Core}'),
('Hanging Leg Raise',              'Ανυψώσεις ποδιών σε κρέμαση',          '{Core}'),
('Lying Leg Raise',                'Ανυψώσεις ποδιών ξαπλωτός',            '{Core}'),
('Ab Wheel Rollout',               'Ροδάκι κοιλιακών',                     '{Core}'),
('Russian Twist',                  'Ρώσικες περιστροφές',                  '{Core}'),
('Pallof Press',                   'Pallof press',                         '{Core}'),
('Plank',                          'Σανίδα (plank)', '{Core,Lower,Full Body}'),
('Side Plank',                     'Πλάγια σανίδα',                        '{Core}'),
('Hollow Body Hold',               'Στατική θέση hollow',                  '{Core}'),
('Wall Sit',                       'Κάθισμα στον τοίχο',                   '{Legs,Lower}'),
('Dead Hang',                      'Κρέμαση από μονόζυγο',                 '{Pull,Back}'),
('Farmer''s Carry',                'Μεταφορά αγρότη (farmer''s carry)',    '{Full Body}'),
('Jump Rope',                      'Σχοινάκι',                             '{Full Body}');

-- Add missing exercises; fill Greek names on existing ones.
insert into public.exercises (exercise_name, exercise_name_el)
select s.name_en, s.name_el
from exercise_seed s
where not exists (select 1 from public.exercises e where lower(e.exercise_name) = lower(s.name_en));

update public.exercises e
set exercise_name_el = s.name_el
from exercise_seed s
where lower(e.exercise_name) = lower(s.name_en)
  and e.exercise_name_el is null;

-- Link library exercises to their splits.
insert into public.exercise_splits (exercise_id, split_id)
select e.exercise_id, sp.split_id
from exercise_seed s
cross join lateral unnest(s.split_names) as sn (split_name)
join public.exercises e on lower(e.exercise_name) = lower(s.name_en)
join public.splits sp   on sp.split_name = sn.split_name
on conflict do nothing;

-- Biceps and Triceps are separate splits: retire the old combined "Arms" split.
-- Exercises that were only in Arms move to Biceps or Triceps (guessed from the
-- name, else both); past workouts tagged Arms get both, so history keeps them.
insert into public.exercise_splits (exercise_id, split_id)
select es.exercise_id, sp.split_id
from public.exercise_splits es
join public.splits a    on a.split_id = es.split_id and a.split_name = 'Arms'
join public.exercises e on e.exercise_id = es.exercise_id
join public.splits sp   on sp.split_name in ('Biceps', 'Triceps')
where not exists (select 1 from public.exercise_splits x
                  join public.splits xs on xs.split_id = x.split_id
                  where x.exercise_id = es.exercise_id and xs.split_name in ('Biceps', 'Triceps'))
  and case when e.exercise_name ~* 'curl|bicep|chin' then sp.split_name = 'Biceps'
           when e.exercise_name ~* 'tricep|extension|push-?down|dip|kickback|skull|close-grip' then sp.split_name = 'Triceps'
           else true end
on conflict do nothing;

insert into public.workout_splits (workout_id, split_id)
select ws.workout_id, sp.split_id
from public.workout_splits ws
join public.splits a  on a.split_id = ws.split_id and a.split_name = 'Arms'
join public.splits sp on sp.split_name in ('Biceps', 'Triceps')
on conflict do nothing;

delete from public.splits where split_name = 'Arms';   -- its exercise & workout links go with it

update public.exercises
set measure = 'time'
where lower(exercise_name) in ('plank', 'side plank', 'hollow body hold', 'wall sit',
                               'dead hang', 'farmer''s carry', 'jump rope')
  and measure <> 'time';

commit;
