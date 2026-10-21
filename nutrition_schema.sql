-- ============================================================
-- Metron — nutrition tables (food preferences & generated plans)
-- Run in the Supabase SQL Editor AFTER schema.sql.
--
-- Macros are per 100 g, RAW weight unless the name says otherwise
-- (e.g. canned & drained). Catalog values are based on USDA FoodData
-- Central (SR Legacy / Foundation); branded products vary, so check labels.
-- ============================================================


-- ------------------------------------------------------------
-- foods — catalog + user-added foods
-- ------------------------------------------------------------
create table public.foods (
    food_id     bigint generated always as identity primary key,
    name_en     text         not null unique,
    name_el     text,
    category    text         not null
                check (category in ('protein', 'carbs', 'fats', 'vegetables', 'fruit')),
    kcal        numeric(6,1) not null check (kcal >= 0),
    protein     numeric(5,2) not null default 0 check (protein >= 0),
    carbs       numeric(5,2) not null default 0 check (carbs >= 0),
    fat         numeric(5,2) not null default 0 check (fat >= 0),
    piece_grams numeric(6,1) check (piece_grams > 0),   -- weight of 1 piece (egg, apple, slice), if counted in pieces
    meal_slots  text[]       not null default '{breakfast,lunch,snack,dinner}'
                check (meal_slots <@ array['breakfast', 'lunch', 'snack', 'dinner']
                       and cardinality(meal_slots) > 0),
    is_custom   boolean      not null default false,
    source      text         not null default 'catalog'
                check (source in ('catalog', 'custom', 'usda', 'openfoodfacts')),
    external_id text,                                   -- USDA fdcId or Open Food Facts barcode
    created_at  timestamptz  not null default now()
);

create index foods_category_idx on public.foods (category);


-- ------------------------------------------------------------
-- food_preferences — like / dislike / allergy (no row = neutral)
-- ------------------------------------------------------------
create table public.food_preferences (
    food_id    bigint      primary key references public.foods (food_id) on delete cascade,
    preference text        not null check (preference in ('like', 'dislike', 'allergy')),
    updated_at timestamptz not null default now()
);

create trigger food_preferences_updated_at
    before update on public.food_preferences
    for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- meal_plans — one row per generated plan (the app keeps the latest)
-- Targets are a snapshot of the profile at generation time.
-- ------------------------------------------------------------
create table public.meal_plans (
    plan_id        bigint generated always as identity primary key,
    kcal_target    integer     not null,
    protein_target integer     not null,
    carbs_target   integer     not null,
    fat_target     integer     not null,
    created_at     timestamptz not null default now()
);


-- ------------------------------------------------------------
-- meal_plan_items — one food (with grams) in one meal of one day
-- Macros are computed from foods × grams, so they are not stored twice.
-- ------------------------------------------------------------
create table public.meal_plan_items (
    item_id     bigint generated always as identity primary key,
    plan_id     bigint       not null references public.meal_plans (plan_id) on delete cascade,
    day_of_week smallint     not null check (day_of_week between 1 and 7),   -- 1 = Monday … 7 = Sunday
    meal        text         not null check (meal in ('Breakfast', 'Lunch', 'Snack', 'Dinner')),
    food_id     bigint       not null references public.foods (food_id) on delete restrict,
    grams       numeric(6,1) not null check (grams > 0),
    sort_order  smallint     not null default 0
);

create index meal_plan_items_plan_idx on public.meal_plan_items (plan_id, day_of_week);
create index meal_plan_items_food_idx on public.meal_plan_items (food_id);


-- ------------------------------------------------------------
-- Row Level Security (same open policy as schema.sql — no login)
-- ------------------------------------------------------------
alter table public.foods            enable row level security;
alter table public.food_preferences enable row level security;
alter table public.meal_plans       enable row level security;
alter table public.meal_plan_items  enable row level security;

create policy "app full access" on public.foods            for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.food_preferences for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.meal_plans       for all to anon, authenticated using (true) with check (true);
create policy "app full access" on public.meal_plan_items  for all to anon, authenticated using (true) with check (true);


-- ============================================================
-- Seed: food catalog (per 100 g)
-- ============================================================
insert into public.foods (name_en, name_el, category, kcal, protein, carbs, fat, piece_grams, meal_slots) values
-- Protein
('Chicken breast (skinless)',        'Στήθος κοτόπουλο (χωρίς πέτσα)',    'protein', 120, 22.5,  0.0,  2.6, null, '{lunch,dinner}'),
('Chicken thigh (skinless)',         'Μπούτι κοτόπουλο (χωρίς πέτσα)',    'protein', 119, 19.7,  0.0,  3.9, null, '{lunch,dinner}'),
('Turkey breast',                    'Στήθος γαλοπούλας',                 'protein', 111, 24.6,  0.0,  0.7, null, '{lunch,dinner}'),
('Lean beef steak',                  'Άπαχη μοσχαρίσια μπριζόλα',         'protein', 142, 21.5,  0.0,  6.0, null, '{lunch,dinner}'),
('Lean beef mince 5% fat',           'Άπαχος μοσχαρίσιος κιμάς 5%',       'protein', 137, 21.4,  0.0,  5.0, null, '{lunch,dinner}'),
('Beef mince 10% fat',               'Μοσχαρίσιος κιμάς 10%',             'protein', 176, 20.0,  0.0, 10.0, null, '{lunch,dinner}'),
('Pork tenderloin',                  'Χοιρινό φιλέτο',                    'protein', 109, 21.0,  0.0,  2.2, null, '{lunch,dinner}'),
('Pork loin (lean)',                 'Χοιρινό κόντρα φιλέτο (άπαχο)',     'protein', 143, 21.1,  0.0,  5.9, null, '{lunch,dinner}'),
('Salmon',                           'Σολομός',                           'protein', 208, 20.4,  0.0, 13.4, null, '{lunch,dinner}'),
('Cod',                              'Μπακαλιάρος',                       'protein',  82, 17.8,  0.0,  0.7, null, '{lunch,dinner}'),
('Sea bass',                         'Λαβράκι',                           'protein',  97, 18.4,  0.0,  2.0, null, '{lunch,dinner}'),
('Shrimp',                           'Γαρίδες',                           'protein',  85, 20.1,  0.0,  0.5, null, '{lunch,dinner}'),
('Squid',                            'Καλαμάρι',                          'protein',  92, 15.6,  3.1,  1.4, null, '{lunch,dinner}'),
('Octopus',                          'Χταπόδι',                           'protein',  82, 14.9,  2.2,  1.0, null, '{lunch,dinner}'),
('Tuna in water (canned, drained)',  'Τόνος σε νερό (κονσέρβα, στραγγισμένος)', 'protein', 116, 25.5, 0.0, 0.8, null, '{lunch,snack,dinner}'),
('Sardines in oil (canned, drained)','Σαρδέλες σε λάδι (κονσέρβα, στραγγισμένες)', 'protein', 208, 24.6, 0.0, 11.5, null, '{lunch,dinner}'),
('Eggs (whole)',                     'Αυγά (ολόκληρα)',                   'protein', 143, 12.6,  0.7,  9.5, 50,   '{breakfast,lunch,dinner}'),
('Egg whites',                       'Ασπράδια αυγών',                    'protein',  52, 10.9,  0.7,  0.2, null, '{breakfast}'),
('Greek yogurt 2%',                  'Στραγγιστό γιαούρτι 2%',            'protein',  73, 10.0,  3.9,  1.9, null, '{breakfast,snack}'),
('Greek yogurt 0%',                  'Στραγγιστό γιαούρτι 0%',            'protein',  59, 10.2,  3.6,  0.4, null, '{breakfast,snack}'),
('Cottage cheese (low-fat)',         'Cottage cheese (χαμηλά λιπαρά)',    'protein',  84, 11.0,  4.3,  2.3, null, '{breakfast,snack}'),
('Whey protein powder',              'Πρωτεΐνη whey (σκόνη)',             'protein', 390, 78.0,  7.0,  6.0, null, '{breakfast,snack}'),
('Turkey ham (deli)',                'Γαλοπούλα (αλλαντικό)',             'protein', 104, 17.0,  4.0,  2.0, null, '{breakfast,snack}'),
('Tofu (firm)',                      'Τόφου (σφιχτό)',                    'protein', 144, 17.3,  2.8,  8.7, null, '{lunch,dinner}'),
-- Carbs (grains & legumes are DRY weight)
('Oats (rolled)',                    'Βρώμη',                             'carbs',   379, 13.2, 67.7,  6.5, null, '{breakfast}'),
('White rice',                       'Λευκό ρύζι',                        'carbs',   365,  7.1, 80.0,  0.7, null, '{lunch,dinner}'),
('Brown rice',                       'Καστανό ρύζι',                      'carbs',   370,  7.9, 77.2,  2.9, null, '{lunch,dinner}'),
('Potatoes',                         'Πατάτες',                           'carbs',    77,  2.0, 17.5,  0.1, null, '{lunch,dinner}'),
('Sweet potatoes',                   'Γλυκοπατάτες',                      'carbs',    86,  1.6, 20.1,  0.1, null, '{lunch,dinner}'),
('Pasta',                            'Ζυμαρικά',                          'carbs',   371, 13.0, 74.7,  1.5, null, '{lunch,dinner}'),
('Whole wheat pasta',                'Ζυμαρικά ολικής άλεσης',            'carbs',   348, 14.6, 71.3,  2.5, null, '{lunch,dinner}'),
('Whole grain bread',                'Ψωμί ολικής άλεσης',                'carbs',   252, 12.4, 42.7,  3.5, 30,   '{breakfast,lunch,dinner}'),
('White bread',                      'Λευκό ψωμί',                        'carbs',   266,  8.9, 49.4,  3.3, 30,   '{breakfast,lunch,dinner}'),
('Pita bread',                       'Αραβική πίτα',                      'carbs',   275,  9.1, 55.7,  1.2, 60,   '{lunch,dinner}'),
('Rice cakes',                       'Ρυζογκοφρέτες',                     'carbs',   387,  8.2, 81.5,  2.8, 9,    '{breakfast,snack}'),
('Quinoa',                           'Κινόα',                             'carbs',   368, 14.1, 64.2,  6.1, null, '{lunch,dinner}'),
('Bulgur',                           'Πλιγούρι',                          'carbs',   342, 12.3, 75.9,  1.3, null, '{lunch,dinner}'),
('Couscous',                         'Κους κους',                         'carbs',   376, 12.8, 77.4,  0.6, null, '{lunch,dinner}'),
('Lentils',                          'Φακές',                             'carbs',   352, 24.6, 63.4,  1.1, null, '{lunch,dinner}'),
('Chickpeas',                        'Ρεβίθια',                           'carbs',   378, 20.5, 62.9,  6.0, null, '{lunch,dinner}'),
('White beans',                      'Φασόλια',                           'carbs',   333, 23.4, 60.3,  0.9, null, '{lunch,dinner}'),
-- Fruit
('Apple',                            'Μήλο',                              'fruit',    52,  0.3, 13.8,  0.2, 180,  '{breakfast,snack}'),
('Banana',                           'Μπανάνα',                           'fruit',    89,  1.1, 22.8,  0.3, 120,  '{breakfast,snack}'),
('Orange',                           'Πορτοκάλι',                         'fruit',    47,  0.9, 11.8,  0.1, 150,  '{breakfast,snack}'),
('Pear',                             'Αχλάδι',                            'fruit',    57,  0.4, 15.2,  0.1, 180,  '{breakfast,snack}'),
('Kiwi',                             'Ακτινίδιο',                         'fruit',    61,  1.1, 14.7,  0.5, 75,   '{breakfast,snack}'),
('Peach',                            'Ροδάκινο',                          'fruit',    39,  0.9,  9.5,  0.3, 150,  '{breakfast,snack}'),
('Fresh figs',                       'Σύκα (φρέσκα)',                     'fruit',    74,  0.8, 19.2,  0.3, 50,   '{breakfast,snack}'),
('Strawberries',                     'Φράουλες',                          'fruit',    32,  0.7,  7.7,  0.3, null, '{breakfast,snack}'),
('Blueberries',                      'Μύρτιλα',                           'fruit',    57,  0.7, 14.5,  0.3, null, '{breakfast,snack}'),
('Grapes',                           'Σταφύλια',                          'fruit',    69,  0.7, 18.1,  0.2, null, '{breakfast,snack}'),
('Watermelon',                       'Καρπούζι',                          'fruit',    30,  0.6,  7.6,  0.2, null, '{breakfast,snack}'),
-- Vegetables
('Broccoli',                         'Μπρόκολο',                          'vegetables', 34, 2.8, 6.6, 0.4, null, '{lunch,dinner}'),
('Spinach',                          'Σπανάκι',                           'vegetables', 23, 2.9, 3.6, 0.4, null, '{lunch,dinner}'),
('Tomatoes',                         'Ντομάτες',                          'vegetables', 18, 0.9, 3.9, 0.2, null, '{lunch,dinner}'),
('Cucumber',                         'Αγγούρι',                           'vegetables', 15, 0.7, 3.6, 0.1, null, '{lunch,dinner}'),
('Lettuce',                          'Μαρούλι',                           'vegetables', 17, 1.2, 3.3, 0.3, null, '{lunch,dinner}'),
('Bell peppers',                     'Πιπεριές',                          'vegetables', 31, 1.0, 6.0, 0.3, null, '{lunch,dinner}'),
('Zucchini',                         'Κολοκυθάκια',                       'vegetables', 17, 1.2, 3.1, 0.3, null, '{lunch,dinner}'),
('Carrots',                          'Καρότα',                            'vegetables', 41, 0.9, 9.6, 0.2, null, '{lunch,dinner}'),
('Green beans',                      'Φασολάκια',                         'vegetables', 31, 1.8, 7.0, 0.2, null, '{lunch,dinner}'),
('Onions',                           'Κρεμμύδια',                         'vegetables', 40, 1.1, 9.3, 0.1, null, '{lunch,dinner}'),
('Cauliflower',                      'Κουνουπίδι',                        'vegetables', 25, 1.9, 5.0, 0.3, null, '{lunch,dinner}'),
('Mushrooms',                        'Μανιτάρια',                         'vegetables', 22, 3.1, 3.3, 0.3, null, '{lunch,dinner}'),
('Eggplant',                         'Μελιτζάνα',                         'vegetables', 25, 1.0, 5.9, 0.2, null, '{lunch,dinner}'),
('Cabbage',                          'Λάχανο',                            'vegetables', 25, 1.3, 5.8, 0.1, null, '{lunch,dinner}'),
-- Fats
('Olive oil (extra virgin)',         'Ελαιόλαδο (έξτρα παρθένο)',         'fats',    884,  0.0,  0.0, 100.0, null, '{lunch,dinner}'),
('Almonds',                          'Αμύγδαλα',                          'fats',    579, 21.2, 21.6, 49.9, null, '{breakfast,snack}'),
('Walnuts',                          'Καρύδια',                           'fats',    654, 15.2, 13.7, 65.2, null, '{breakfast,snack}'),
('Mixed nuts',                       'Ανάμεικτοι ξηροί καρποί',           'fats',    594, 17.3, 25.4, 51.5, null, '{breakfast,snack}'),
('Pistachios',                       'Φιστίκια Αιγίνης',                  'fats',    560, 20.2, 27.2, 45.3, null, '{breakfast,snack}'),
('Peanut butter',                    'Φυστικοβούτυρο',                    'fats',    588, 25.1, 19.6, 50.4, null, '{breakfast,snack}'),
('Tahini',                           'Ταχίνι',                            'fats',    595, 17.0, 21.2, 53.8, null, '{breakfast,lunch,dinner}'),
('Chia seeds',                       'Σπόροι chia',                       'fats',    486, 16.5, 42.1, 30.7, null, '{breakfast,snack}'),
('Avocado',                          'Αβοκάντο',                          'fats',    160,  2.0,  8.5, 14.7, null, '{breakfast,lunch,dinner}'),
('Green olives',                     'Πράσινες ελιές',                    'fats',    145,  1.0,  3.8, 15.3, null, '{lunch,dinner}'),
('Feta cheese',                      'Φέτα',                              'fats',    264, 14.2,  4.1, 21.3, null, '{lunch,dinner}');
