"""
Generate a realistic synthetic seed dataset for Addis Ababa rental prices.

Based on:
  - Engocha.com scraped listings
  - Real Addis Ababa market knowledge (2024-2026)
  - Agent interviews and public property reports

This seeds the model before sufficient real platform data accumulates.
As real listings grow (100+), retrain.py will naturally favour real data.

Usage:
    python generate_seed_data.py
    python generate_seed_data.py --samples 300 --output data/seed_listings.json
"""

import argparse
import json
import os
import random

random.seed(42)

# ─── Market parameters (Addis Ababa 2025-2026) ────────────────────────────────

SUBCITY_CONFIG = {
    #  sub_city:        (base_etb_per_sqm, std_fraction, typical_area_range, typical_beds)
    "bole":             (950,  0.22, (50, 350),  (1, 4)),
    "kirkos":           (780,  0.20, (40, 280),  (1, 4)),
    "arada":            (660,  0.20, (35, 200),  (1, 3)),
    "lideta":           (590,  0.18, (35, 180),  (1, 3)),
    "yeka":             (700,  0.22, (50, 300),  (2, 5)),
    "nifas silk-lafto": (640,  0.20, (40, 250),  (1, 4)),
    "addis ketema":     (530,  0.18, (30, 160),  (1, 3)),
    "kolfe keranio":    (490,  0.18, (35, 200),  (1, 4)),
    "gullele":          (520,  0.18, (35, 200),  (1, 4)),
    "akaky kaliti":     (440,  0.20, (40, 250),  (2, 5)),
}

PROPERTY_TYPE_MULT = {
    "villa":       (1.45, 0.12),
    "house":       (1.22, 0.10),
    "apartment":   (1.00, 0.08),
    "condominium": (0.82, 0.06),
}

PROPERTY_TYPE_WEIGHTS = {
    "bole":             {"apartment": 0.50, "villa": 0.20, "house": 0.20, "condominium": 0.10},
    "kirkos":           {"apartment": 0.55, "house": 0.25, "villa": 0.10, "condominium": 0.10},
    "arada":            {"apartment": 0.45, "house": 0.30, "condominium": 0.15, "villa": 0.10},
    "lideta":           {"house": 0.40, "apartment": 0.35, "condominium": 0.15, "villa": 0.10},
    "yeka":             {"house": 0.45, "apartment": 0.30, "villa": 0.15, "condominium": 0.10},
    "nifas silk-lafto": {"apartment": 0.45, "house": 0.30, "condominium": 0.15, "villa": 0.10},
    "addis ketema":     {"house": 0.45, "apartment": 0.35, "condominium": 0.15, "villa": 0.05},
    "kolfe keranio":    {"house": 0.50, "apartment": 0.30, "condominium": 0.15, "villa": 0.05},
    "gullele":          {"house": 0.50, "apartment": 0.30, "condominium": 0.15, "villa": 0.05},
    "akaky kaliti":     {"house": 0.45, "apartment": 0.30, "villa": 0.15, "condominium": 0.10},
}

CONDITION_CONFIG = {
    "new_build":        (1.30, 0.08),
    "excellent":        (1.18, 0.07),
    "good":             (1.00, 0.06),
    "fair":             (0.85, 0.08),
    "needs_renovation": (0.70, 0.10),
}
CONDITION_WEIGHTS = [0.08, 0.25, 0.40, 0.18, 0.09]

FURNISHING_CONFIG = {
    "furnished":     (1.32, 0.08),
    "semi_furnished": (1.14, 0.06),
    "unfurnished":   (1.00, 0.05),
}
FURNISHING_WEIGHTS = [0.25, 0.35, 0.40]

AMENITIES_POOL = [
    "parking", "generator", "security", "elevator", "garden",
    "swimming_pool", "gym", "internet", "water_tanker", "ceramic_floor",
]
# More upscale sub-cities get more amenities on average
AMENITY_PROB_BY_SUBCITY = {
    "bole": 0.55, "kirkos": 0.45, "arada": 0.35,
    "lideta": 0.30, "yeka": 0.40, "nifas silk-lafto": 0.35,
    "addis ketema": 0.22, "kolfe keranio": 0.20,
    "gullele": 0.22, "akaky kaliti": 0.25,
}


def gauss_mult(mean_mult: float, std_frac: float) -> float:
    """Return a Gaussian multiplier with the given mean and fractional std."""
    return max(0.5, random.gauss(mean_mult, mean_mult * std_frac))


def weighted_choice(options: dict) -> str:
    keys = list(options.keys())
    weights = list(options.values())
    return random.choices(keys, weights=weights, k=1)[0]


def generate_sample(sub_city: str) -> dict:
    cfg = SUBCITY_CONFIG[sub_city]
    base_ppsm, sc_std, area_range, bed_range = cfg

    # Area (m²)
    area = round(random.triangular(area_range[0], area_range[1], (area_range[0] + area_range[1]) / 2), 1)

    # Bedrooms (correlated with area)
    min_beds, max_beds = bed_range
    beds_raw = int(round(random.gauss(
        min_beds + (area - area_range[0]) / (area_range[1] - area_range[0]) * (max_beds - min_beds),
        0.8,
    )))
    bedrooms = max(min_beds, min(max_beds + 1, beds_raw))

    # Bathrooms (roughly correlated with bedrooms)
    bathrooms = max(1, min(bedrooms, bedrooms - random.choice([0, 0, 0, 1])))

    # Property type
    prop_type = weighted_choice(PROPERTY_TYPE_WEIGHTS[sub_city])

    # Condition
    condition = random.choices(
        list(CONDITION_CONFIG.keys()),
        weights=CONDITION_WEIGHTS,
        k=1,
    )[0]

    # Furnishing
    furnishing = random.choices(
        ["furnished", "semi_furnished", "unfurnished"],
        weights=FURNISHING_WEIGHTS,
        k=1,
    )[0]

    # Amenities
    amenity_prob = AMENITY_PROB_BY_SUBCITY[sub_city]
    amenities = [a for a in AMENITIES_POOL if random.random() < amenity_prob]

    # ── Price calculation ──────────────────────────────────────────────────────
    # Base: area × price/sqm (with sub-city noise)
    ppsm = base_ppsm * gauss_mult(1.0, sc_std)
    price = area * ppsm

    # Property type multiplier
    pt_mult, pt_std = PROPERTY_TYPE_MULT[prop_type]
    price *= gauss_mult(pt_mult, pt_std)

    # Condition multiplier
    cond_mult, cond_std = CONDITION_CONFIG[condition]
    price *= gauss_mult(cond_mult, cond_std)

    # Furnishing multiplier
    furn_mult, furn_std = FURNISHING_CONFIG[furnishing]
    price *= gauss_mult(furn_mult, furn_std)

    # Bedroom adjustment (2 bedrooms is the baseline reference)
    bed_factor = 1.0 + (bedrooms - 2) * random.gauss(0.075, 0.015)
    price *= max(0.65, min(bed_factor, 1.90))

    # Amenity premium
    amenity_premium = sum(random.gauss(0.025, 0.005) for _ in amenities)
    price *= (1 + min(amenity_premium, 0.20))

    # Add final market noise (+/- 12%)
    price *= random.gauss(1.0, 0.12)
    price = max(4_000, round(price / 500) * 500)  # snap to 500 ETB increments

    return {
        "price_etb": float(price),
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "sub_city": sub_city,
        "property_type": prop_type,
        "home_condition": condition,
        "furnishing": furnishing,
        "amenities": amenities,
        "amenities_count": len(amenities),
        "has_parking": int("parking" in amenities),
        "has_generator": int("generator" in amenities),
        "has_security": int("security" in amenities),
        "has_elevator": int("elevator" in amenities),
        "data_source": "synthetic",
    }


# Sub-city sampling weights (proportional to real listing frequency)
SUBCITY_SAMPLE_WEIGHTS = {
    "bole": 0.18, "kirkos": 0.14, "arada": 0.10,
    "lideta": 0.08, "yeka": 0.12, "nifas silk-lafto": 0.10,
    "addis ketema": 0.08, "kolfe keranio": 0.08,
    "gullele": 0.06, "akaky kaliti": 0.06,
}


def generate_dataset(n_samples: int) -> list[dict]:
    sub_cities = list(SUBCITY_SAMPLE_WEIGHTS.keys())
    weights = list(SUBCITY_SAMPLE_WEIGHTS.values())
    samples = []
    for _ in range(n_samples):
        sc = random.choices(sub_cities, weights=weights, k=1)[0]
        samples.append(generate_sample(sc))
    return samples


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic seed dataset")
    parser.add_argument("--samples", type=int, default=300, help="Number of samples")
    parser.add_argument("--output", default="data/seed_listings.json")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    data = generate_dataset(args.samples)

    with open(args.output, "w") as f:
        json.dump(data, f, indent=2)

    prices = [d["price_etb"] for d in data]
    print(f"Generated {len(data)} synthetic samples → {args.output}")
    print(f"Price range: {min(prices):,.0f} – {max(prices):,.0f} ETB")
    print(f"Price median: {sorted(prices)[len(prices)//2]:,.0f} ETB")
