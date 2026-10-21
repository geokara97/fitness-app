// ============================================================
// Nutrition plan — transcribed from nutrition_plan_v4.pdf
// 1800 kcal | Fat Loss | Muscle Retention  (90 kg -> 75 kg)
// All meat, fish, rice, oats and potatoes are RAW weight.
// ============================================================

const NUTRITION_PLAN = {
    meta: {
        title: 'Weekly Nutrition Plan',
        subtitle: '1800 kcal — Fat Loss & Muscle Retention',
        calories: 1800,
        protein: 170,
        carbs: 145,
        fat: 55,
        notes: [
            'All meat, fish, rice, oats and potatoes are listed in RAW weight.',
            'Vegetables can be eaten freely unless otherwise stated.',
            'Daily whey shake is built into the plan.',
        ],
    },

    days: [
        {
            day: 'Monday',
            total: { kcal: 1795, p: 175, c: 145, f: 50 },
            meals: [
                { name: 'Breakfast', kcal: 490, p: 48, c: 65, f: 6,
                  items: ['80 g oats (raw)', '30 g whey protein powder', '200 g low-fat Greek yogurt', 'Cinnamon to taste'] },
                { name: 'Lunch', kcal: 530, p: 50, c: 45, f: 13,
                  items: ['250 g white fish (raw)', '50 g rice (raw)', 'Salad', '10 g olive oil'] },
                { name: 'Snack', kcal: 235, p: 26, c: 22, f: 4,
                  items: ['200 g low-fat cottage cheese', '1 apple'] },
                { name: 'Dinner', kcal: 540, p: 51, c: 56, f: 9,
                  items: ['220 g chicken breast (raw)', '300 g potatoes (raw)', 'Vegetables', '5 g olive oil'] },
            ],
        },
        {
            day: 'Tuesday',
            total: { kcal: 1810, p: 168, c: 150, f: 55 },
            meals: [
                { name: 'Breakfast', kcal: 480, p: 36, c: 36, f: 20,
                  items: ['3 whole eggs', '80 g whole grain bread', '80 g turkey ham'] },
                { name: 'Lunch', kcal: 620, p: 52, c: 65, f: 18,
                  items: ['220 g lean beef steak (raw)', '350 g potatoes (raw)', 'Salad', '10 g olive oil'] },
                { name: 'Snack', kcal: 215, p: 22, c: 8, f: 9,
                  items: ['200 g low-fat Greek yogurt', '15 g mixed nuts'] },
                { name: 'Dinner', kcal: 495, p: 58, c: 41, f: 8,
                  items: ['220 g chicken breast (raw)', '50 g rice (raw)', 'Vegetables', '5 g olive oil'] },
            ],
        },
        {
            day: 'Wednesday',
            total: { kcal: 1780, p: 166, c: 150, f: 52 },
            meals: [
                { name: 'Breakfast', kcal: 470, p: 36, c: 67, f: 7,
                  items: ['70 g oats (raw)', '30 g whey protein powder', '1 banana'] },
                { name: 'Lunch', kcal: 570, p: 52, c: 43, f: 18,
                  items: ['220 g pork tenderloin (raw)', '50 g rice (raw)', 'Vegetables', '10 g olive oil'] },
                { name: 'Snack', kcal: 250, p: 26, c: 7, f: 13,
                  items: ['200 g low-fat cottage cheese', '15 g walnuts'] },
                { name: 'Dinner', kcal: 490, p: 52, c: 33, f: 14,
                  items: ['220 g lean beef mince 5% fat (raw)', 'Large salad', '40 g whole grain bread', '5 g olive oil'] },
            ],
        },
        {
            day: 'Thursday',
            total: { kcal: 1800, p: 175, c: 140, f: 53 },
            meals: [
                { name: 'Breakfast', kcal: 505, p: 39, c: 39, f: 22,
                  items: ['3 whole eggs', '60 g oats (raw)', '80 g turkey ham'] },
                { name: 'Lunch', kcal: 575, p: 53, c: 60, f: 13,
                  items: ['220 g chicken breast (raw)', '300 g sweet potato (raw)', 'Salad', '10 g olive oil'] },
                { name: 'Snack', kcal: 200, p: 21, c: 24, f: 0,
                  items: ['200 g low-fat Greek yogurt', '1 apple'] },
                { name: 'Dinner', kcal: 520, p: 62, c: 41, f: 13,
                  items: ['220 g lean beef mince 5% fat (raw)', '50 g rice (raw)', 'Vegetables', '5 g olive oil'] },
            ],
        },
        {
            day: 'Friday',
            total: { kcal: 1795, p: 168, c: 145, f: 55 },
            meals: [
                { name: 'Breakfast', kcal: 530, p: 38, c: 56, f: 16,
                  items: ['80 g oats (raw)', '30 g whey protein powder', '15 g peanut butter'] },
                { name: 'Lunch', kcal: 565, p: 56, c: 65, f: 14,
                  items: ['2 cans tuna in water (drained ~240 g)', '350 g potatoes (raw)', 'Vegetables', '10 g olive oil'] },
                { name: 'Snack', kcal: 210, p: 23, c: 21, f: 4,
                  items: ['200 g low-fat cottage cheese', '1 piece of fruit'] },
                { name: 'Dinner', kcal: 490, p: 51, c: 41, f: 11,
                  items: ['220 g pork loin (raw)', '50 g rice (raw)', 'Salad', '5 g olive oil'] },
            ],
        },
        {
            day: 'Saturday',
            total: { kcal: 1820, p: 165, c: 130, f: 65 },
            meals: [
                { name: 'Breakfast', kcal: 555, p: 38, c: 41, f: 26,
                  items: ['3 whole eggs', '80 g whole grain bread', '80 g turkey ham', '15 g mixed nuts'] },
                { name: 'Lunch', kcal: 530, p: 49, c: 41, f: 19,
                  items: ['220 g salmon (raw)', '50 g rice (raw)', 'Vegetables'] },
                { name: 'Snack', kcal: 215, p: 21, c: 32, f: 0,
                  items: ['200 g low-fat Greek yogurt', '1 banana'] },
                { name: 'Dinner', kcal: 520, p: 57, c: 56, f: 13,
                  items: ['220 g chicken breast (raw)', '300 g potatoes (raw)', 'Salad', '10 g olive oil'] },
            ],
        },
        {
            day: 'Sunday',
            total: { kcal: 1785, p: 167, c: 140, f: 55 },
            meals: [
                { name: 'Breakfast', kcal: 490, p: 35, c: 47, f: 16,
                  items: ['70 g oats (raw)', '30 g whey protein powder', '15 g walnuts'] },
                { name: 'Lunch', kcal: 565, p: 53, c: 41, f: 19,
                  items: ['220 g lean beef steak (raw)', '50 g rice (raw)', 'Vegetables', '10 g olive oil'] },
                { name: 'Snack', kcal: 210, p: 23, c: 21, f: 4,
                  items: ['200 g low-fat cottage cheese', '1 piece of fruit'] },
                { name: 'Dinner', kcal: 520, p: 56, c: 56, f: 9,
                  items: ['250 g chicken breast (raw)', '300 g potatoes (raw)', 'Salad', '5 g olive oil'] },
            ],
        },
    ],

    rotation: {
        protein: ['Chicken breast', 'Lean beef', 'Lean beef mince 5%', 'Pork tenderloin',
                  'Pork loin', 'Salmon', 'White fish', 'Tuna (canned in water)', 'Eggs',
                  'Turkey ham', 'Cottage cheese (low-fat)', 'Greek yogurt (low-fat)', 'Whey protein'],
        carbs: ['Oats', 'Rice', 'Potatoes', 'Sweet potatoes', 'Whole grain bread', 'Fruit'],
        fats: ['Olive oil (extra virgin)', 'Almonds', 'Walnuts', 'Mixed nuts', 'Peanut butter'],
    },

    oilSwaps: [
        ['100 g potatoes (raw)', '10 g olive oil'],
        ['15 g oats (raw)', '5 g olive oil'],
        ['30 g rice (raw)', '5 g olive oil'],
        ['1 slice bread', '10 g olive oil'],
    ],

    tips: [
        'Keep protein high every single day.',
        'Train hard — but recover properly between sessions.',
        'Sleep 7-9 hours nightly for optimal fat loss and muscle retention.',
        'Drink plenty of water (aim for 2.5-3 L daily, more on training days).',
        "Aim for consistency, not perfection — one off-day won't ruin progress.",
        'Track body weight 2-3 times weekly under the same conditions (morning, fasted).',
    ],
};

// ---- Greek text for the plan (keyed by the English string) ----
const NUTRITION_PLAN_EL = {
    'Weekly Nutrition Plan': 'Εβδομαδιαίο Πρόγραμμα Διατροφής',
    '1800 kcal — Fat Loss & Muscle Retention': '1800 kcal — Απώλεια Λίπους & Διατήρηση Μυϊκής Μάζας',
    'All meat, fish, rice, oats and potatoes are listed in RAW weight.': 'Όλα τα κρέατα, τα ψάρια, το ρύζι, η βρώμη και οι πατάτες αναφέρονται σε ΩΜΟ βάρος.',
    'Vegetables can be eaten freely unless otherwise stated.': 'Τα λαχανικά τρώγονται ελεύθερα, εκτός αν αναφέρεται διαφορετικά.',
    'Daily whey shake is built into the plan.': 'Το καθημερινό ρόφημα πρωτεΐνης whey περιλαμβάνεται στο πρόγραμμα.',

    // Meal items
    '80 g oats (raw)': '80 g βρώμη (ωμή)',
    '70 g oats (raw)': '70 g βρώμη (ωμή)',
    '60 g oats (raw)': '60 g βρώμη (ωμή)',
    '30 g whey protein powder': '30 g πρωτεΐνη whey σε σκόνη',
    '200 g low-fat Greek yogurt': '200 g στραγγιστό γιαούρτι χαμηλών λιπαρών',
    'Cinnamon to taste': 'Κανέλα κατά βούληση',
    '250 g white fish (raw)': '250 g λευκό ψάρι (ωμό)',
    '50 g rice (raw)': '50 g ρύζι (ωμό)',
    'Salad': 'Σαλάτα',
    'Large salad': 'Μεγάλη σαλάτα',
    'Vegetables': 'Λαχανικά',
    '10 g olive oil': '10 g ελαιόλαδο',
    '5 g olive oil': '5 g ελαιόλαδο',
    '200 g low-fat cottage cheese': '200 g cottage cheese χαμηλών λιπαρών',
    '1 apple': '1 μήλο',
    '1 banana': '1 μπανάνα',
    '1 piece of fruit': '1 φρούτο',
    '220 g chicken breast (raw)': '220 g στήθος κοτόπουλο (ωμό)',
    '250 g chicken breast (raw)': '250 g στήθος κοτόπουλο (ωμό)',
    '300 g potatoes (raw)': '300 g πατάτες (ωμές)',
    '350 g potatoes (raw)': '350 g πατάτες (ωμές)',
    '300 g sweet potato (raw)': '300 g γλυκοπατάτα (ωμή)',
    '3 whole eggs': '3 ολόκληρα αυγά',
    '80 g whole grain bread': '80 g ψωμί ολικής άλεσης',
    '40 g whole grain bread': '40 g ψωμί ολικής άλεσης',
    '80 g turkey ham': '80 g γαλοπούλα (αλλαντικό)',
    '220 g lean beef steak (raw)': '220 g άπαχη μοσχαρίσια μπριζόλα (ωμή)',
    '220 g lean beef mince 5% fat (raw)': '220 g άπαχος μοσχαρίσιος κιμάς 5% λιπαρά (ωμός)',
    '220 g pork tenderloin (raw)': '220 g χοιρινό φιλέτο (ωμό)',
    '220 g pork loin (raw)': '220 g χοιρινό κόντρα φιλέτο (ωμό)',
    '220 g salmon (raw)': '220 g σολομός (ωμός)',
    '2 cans tuna in water (drained ~240 g)': '2 κονσέρβες τόνος σε νερό (στραγγισμένος ~240 g)',
    '15 g mixed nuts': '15 g ανάμεικτοι ξηροί καρποί',
    '15 g walnuts': '15 g καρύδια',
    '15 g peanut butter': '15 g φυστικοβούτυρο',

    // Rotation
    'Chicken breast': 'Στήθος κοτόπουλο',
    'Lean beef': 'Άπαχο μοσχάρι',
    'Lean beef mince 5%': 'Άπαχος μοσχαρίσιος κιμάς 5%',
    'Pork tenderloin': 'Χοιρινό φιλέτο',
    'Pork loin': 'Χοιρινό κόντρα φιλέτο',
    'Salmon': 'Σολομός',
    'White fish': 'Λευκό ψάρι',
    'Tuna (canned in water)': 'Τόνος (κονσέρβα σε νερό)',
    'Eggs': 'Αυγά',
    'Turkey ham': 'Γαλοπούλα (αλλαντικό)',
    'Cottage cheese (low-fat)': 'Cottage cheese (χαμηλά λιπαρά)',
    'Greek yogurt (low-fat)': 'Στραγγιστό γιαούρτι (χαμηλά λιπαρά)',
    'Whey protein': 'Πρωτεΐνη whey',
    'Oats': 'Βρώμη',
    'Rice': 'Ρύζι',
    'Potatoes': 'Πατάτες',
    'Sweet potatoes': 'Γλυκοπατάτες',
    'Whole grain bread': 'Ψωμί ολικής άλεσης',
    'Fruit': 'Φρούτα',
    'Olive oil (extra virgin)': 'Ελαιόλαδο (έξτρα παρθένο)',
    'Almonds': 'Αμύγδαλα',
    'Walnuts': 'Καρύδια',
    'Mixed nuts': 'Ανάμεικτοι ξηροί καρποί',
    'Peanut butter': 'Φυστικοβούτυρο',

    // Oil swaps
    '100 g potatoes (raw)': '100 g πατάτες (ωμές)',
    '15 g oats (raw)': '15 g βρώμη (ωμή)',
    '30 g rice (raw)': '30 g ρύζι (ωμό)',
    '1 slice bread': '1 φέτα ψωμί',

    // Tips
    'Keep protein high every single day.': 'Κρατήστε την πρωτεΐνη υψηλή κάθε μέρα.',
    'Train hard — but recover properly between sessions.': 'Προπονηθείτε σκληρά — αλλά αναρρώστε σωστά ανάμεσα στις προπονήσεις.',
    'Sleep 7-9 hours nightly for optimal fat loss and muscle retention.': 'Κοιμηθείτε 7-9 ώρες κάθε βράδυ για βέλτιστη απώλεια λίπους και διατήρηση μυϊκής μάζας.',
    'Drink plenty of water (aim for 2.5-3 L daily, more on training days).': 'Πίνετε άφθονο νερό (στόχος 2,5-3 L την ημέρα, περισσότερο τις ημέρες προπόνησης).',
    "Aim for consistency, not perfection — one off-day won't ruin progress.": 'Στοχεύστε στη συνέπεια, όχι στην τελειότητα — μία κακή μέρα δεν θα χαλάσει την πρόοδο.',
    'Track body weight 2-3 times weekly under the same conditions (morning, fasted).': 'Ζυγίζεστε 2-3 φορές την εβδομάδα υπό τις ίδιες συνθήκες (πρωί, νηστικοί).',
};

// Plan text in the current language (falls back to the English original).
function planText(s) {
    return (LANG === 'el' && NUTRITION_PLAN_EL[s]) || s;
}
