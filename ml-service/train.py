"""
Train the rental price prediction model.

Data sources (combined):
  1. data/scraped_listings.json  — scraped from Engocha.com
  2. PostgreSQL (optional)       — your own platform's verified listings

Usage:
    python train.py
    python train.py --db-url postgresql://... --output models/model.pkl
"""

import argparse
import json
import os
import logging
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

SCRAPED_DATA_PATH = "data/scraped_listings.json"
SEED_DATA_PATH = "data/seed_listings.json"
MODEL_PATH = "models/model.pkl"
METADATA_PATH = "models/metadata.json"

# Sub-cities in Addis Ababa (canonical names)
KNOWN_SUBCITIES = [
    "bole", "kirkos", "arada", "lideta", "addis ketema",
    "akaky kaliti", "kolfe keranio", "gullele", "nifas silk-lafto", "yeka",
    "other",
]

PROPERTY_TYPES = ["apartment", "house", "condominium", "villa", "other"]

CONDITION_ORDER = [
    ["needs_renovation", "fair", "good", "excellent", "new_build"]
]

FURNISHING_ORDER = [["unfurnished", "semi_furnished", "furnished"]]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_seed_data(path: str) -> pd.DataFrame:
    """Load the synthetic seed dataset (pre-generated market knowledge)."""
    if not os.path.exists(path):
        log.info(f"No seed data at {path}. Run generate_seed_data.py to create it.")
        return pd.DataFrame()

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    df = pd.DataFrame(raw)
    df.rename(columns={"price_etb": "monthly_rent"}, inplace=True)
    log.info(f"Loaded {len(df)} synthetic seed samples")
    return df


def load_scraped_data(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        log.warning(f"Scraped data not found at {path}")
        return pd.DataFrame()

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    rows = []
    for item in raw:
        rows.append({
            "monthly_rent": item.get("price_etb"),
            "area_m2": item.get("area_m2"),
            "bedrooms": item.get("bedrooms"),
            "bathrooms": item.get("bathrooms"),
            "sub_city": item.get("sub_city", "other"),
            "property_type": item.get("property_type", "house"),
            "home_condition": "good",  # engocha doesn't always have this
            "furnishing": item.get("furnishing", "unfurnished"),
            "amenities_count": len(item.get("amenities", [])),
            "has_parking": int("parking" in item.get("amenities", [])),
            "has_generator": int("generator" in item.get("amenities", [])),
            "has_security": int("security" in item.get("amenities", [])),
            "has_elevator": int("elevator" in item.get("amenities", [])),
        })

    return pd.DataFrame(rows)


def load_platform_data(db_url: str) -> pd.DataFrame:
    """Load verified + rented properties from your own platform's database."""
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(db_url)
        query = text("""
            SELECT
                p."monthlyRent"     AS monthly_rent,
                p."area"            AS area_m2,
                p."bedrooms"        AS bedrooms,
                p."bathrooms"       AS bathrooms,
                lower(p."subCity")  AS sub_city,
                lower(p."propertyType"::text) AS property_type,
                lower(p."homeCondition"::text) AS home_condition,
                p."amenities"       AS amenities,
                p."status"
            FROM "Property" p
            WHERE
                p."deletedAt" IS NULL
                AND p."status" IN ('available', 'rented')
                AND p."monthlyRent" > 3000
                AND p."monthlyRent" < 2000000
                AND p."area" > 10
        """)
        df = pd.read_sql(query, engine)
        engine.dispose()

        if df.empty:
            return df

        df["monthly_rent"] = df["monthly_rent"].astype(float)
        df["area_m2"] = df["area_m2"].astype(float)

        def get_amenity_flags(amenities_list):
            a = [x.lower() for x in (amenities_list or [])]
            return {
                "amenities_count": len(a),
                "has_parking": int(any("parking" in x for x in a)),
                "has_generator": int(any("generator" in x for x in a)),
                "has_security": int(any("security" in x for x in a)),
                "has_elevator": int(any("elevator" in x for x in a)),
                "furnishing": (
                    "furnished" if any("furnished" in x and "semi" not in x for x in a)
                    else "semi_furnished" if any("semi" in x for x in a)
                    else "unfurnished"
                ),
            }

        flags = df["amenities"].apply(get_amenity_flags).apply(pd.Series)
        df = pd.concat([df.drop(columns=["amenities"]), flags], axis=1)

        df["home_condition"] = df["home_condition"].fillna("good").replace(
            {"none": "good", "": "good"}
        )

        log.info(f"Loaded {len(df)} listings from platform database")
        return df

    except Exception as e:
        log.warning(f"Could not load platform data: {e}")
        return pd.DataFrame()


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    required = ["monthly_rent", "area_m2", "bedrooms"]
    df = df.dropna(subset=required).copy()

    # Normalise sub_city
    df.loc[:, "sub_city"] = df["sub_city"].str.lower().str.strip().fillna("other")
    df.loc[~df["sub_city"].isin(KNOWN_SUBCITIES), "sub_city"] = "other"

    # Normalise property_type
    df.loc[:, "property_type"] = df["property_type"].str.lower().str.strip().fillna("house")
    df.loc[~df["property_type"].isin(PROPERTY_TYPES), "property_type"] = "other"

    # Normalise home_condition
    valid_conditions = ["needs_renovation", "fair", "good", "excellent", "new_build"]
    df.loc[:, "home_condition"] = df["home_condition"].str.lower().str.strip().fillna("good")
    df.loc[~df["home_condition"].isin(valid_conditions), "home_condition"] = "good"

    # Normalise furnishing
    valid_furnishing = ["unfurnished", "semi_furnished", "furnished"]
    df.loc[:, "furnishing"] = df["furnishing"].str.lower().str.strip().fillna("unfurnished")
    df.loc[~df["furnishing"].isin(valid_furnishing), "furnishing"] = "unfurnished"

    # Fill numeric defaults
    df.loc[:, "bathrooms"] = df["bathrooms"].fillna(df["bedrooms"].clip(upper=4))
    df.loc[:, "amenities_count"] = df["amenities_count"].fillna(0).astype(int)
    df.loc[:, "has_parking"] = df["has_parking"].fillna(0).astype(int)
    df.loc[:, "has_generator"] = df["has_generator"].fillna(0).astype(int)
    df.loc[:, "has_security"] = df["has_security"].fillna(0).astype(int)
    df.loc[:, "has_elevator"] = df["has_elevator"].fillna(0).astype(int)

    # Remove outliers (IQR method on monthly_rent)
    q1 = df["monthly_rent"].quantile(0.05)
    q3 = df["monthly_rent"].quantile(0.95)
    df = df[(df["monthly_rent"] >= q1) & (df["monthly_rent"] <= q3)]

    log.info(f"After cleaning: {len(df)} rows")
    return df.copy().reset_index(drop=True)


def build_pipeline(n_samples: int) -> Pipeline:
    """Choose model complexity based on dataset size."""
    numeric_features = [
        "area_m2", "bedrooms", "bathrooms",
        "amenities_count", "has_parking", "has_generator",
        "has_security", "has_elevator",
    ]
    categorical_ohe = ["sub_city", "property_type"]
    categorical_ord_condition = ["home_condition"]
    categorical_ord_furnishing = ["furnishing"]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numeric_features),
            ("cat_ohe", OneHotEncoder(handle_unknown="ignore", sparse_output=False), categorical_ohe),
            ("cond", OrdinalEncoder(categories=CONDITION_ORDER, handle_unknown="use_encoded_value", unknown_value=-1), categorical_ord_condition),
            ("furn", OrdinalEncoder(categories=FURNISHING_ORDER, handle_unknown="use_encoded_value", unknown_value=-1), categorical_ord_furnishing),
        ]
    )

    if n_samples >= 200:
        estimator = GradientBoostingRegressor(
            n_estimators=200, max_depth=4, learning_rate=0.05,
            min_samples_leaf=5, random_state=42,
        )
        model_name = "GradientBoosting"
    elif n_samples >= 60:
        estimator = RandomForestRegressor(
            n_estimators=200, max_depth=6, min_samples_leaf=3,
            random_state=42, n_jobs=-1,
        )
        model_name = "RandomForest"
    else:
        # Very small dataset — shallow Random Forest to avoid overfitting
        estimator = RandomForestRegressor(
            n_estimators=100, max_depth=4, min_samples_leaf=5,
            random_state=42, n_jobs=-1,
        )
        model_name = "RandomForest(shallow)"

    log.info(f"Using {model_name} for {n_samples} samples")

    return Pipeline([
        ("preprocessor", preprocessor),
        ("model", estimator),
    ]), model_name


# ---------------------------------------------------------------------------
# Training entry point
# ---------------------------------------------------------------------------

def train(scraped_path: str, seed_path: str, db_url: Optional[str], output_model: str, output_meta: str):
    frames = []

    seed = load_seed_data(seed_path)
    if not seed.empty:
        seed["data_source"] = "synthetic"
        frames.append(seed)

    scraped = load_scraped_data(scraped_path)
    if not scraped.empty:
        scraped["data_source"] = "scraped"
        frames.append(scraped)
        log.info(f"Loaded {len(scraped)} scraped listings")

    if db_url:
        platform = load_platform_data(db_url)
        if not platform.empty:
            platform["data_source"] = "platform"
            frames.append(platform)
            log.info(f"Loaded {len(platform)} platform listings")

    if not frames:
        log.error("No data available. Run scraper.py first or provide --db-url.")
        return False

    df = pd.concat(frames, ignore_index=True)
    df = clean_dataframe(df)

    if len(df) < 10:
        log.error(f"Only {len(df)} clean samples — too few to train meaningfully.")
        return False

    FEATURES = [
        "area_m2", "bedrooms", "bathrooms",
        "sub_city", "property_type", "home_condition", "furnishing",
        "amenities_count", "has_parking", "has_generator",
        "has_security", "has_elevator",
    ]
    X = df[FEATURES]
    y = df["monthly_rent"].astype(float)

    pipeline, model_name = build_pipeline(len(df))

    # Cross-validation (only if enough samples)
    cv_mae = None
    cv_r2 = None
    if len(df) >= 20:
        cv_mae_scores = cross_val_score(pipeline, X, y, cv=min(5, len(df) // 4), scoring="neg_mean_absolute_error")
        cv_r2_scores = cross_val_score(pipeline, X, y, cv=min(5, len(df) // 4), scoring="r2")
        cv_mae = float(-cv_mae_scores.mean())
        cv_r2 = float(cv_r2_scores.mean())
        log.info(f"CV MAE: {cv_mae:,.0f} ETB  |  CV R²: {cv_r2:.3f}")

    # Train on full dataset
    pipeline.fit(X, y)

    # In-sample metrics
    y_pred = pipeline.predict(X)
    train_mae = mean_absolute_error(y, y_pred)
    train_r2 = r2_score(y, y_pred)
    log.info(f"Train MAE: {train_mae:,.0f} ETB  |  Train R²: {train_r2:.3f}")

    # Feature importances
    try:
        model_step = pipeline.named_steps["model"]
        pre_step = pipeline.named_steps["preprocessor"]
        feature_names = (
            pre_step.transformers_[0][2]  # numeric
            + list(pre_step.transformers_[1][1].get_feature_names_out(["sub_city", "property_type"]))
            + pre_step.transformers_[2][2]  # condition
            + pre_step.transformers_[3][2]  # furnishing
        )
        importances = dict(zip(feature_names, model_step.feature_importances_.tolist()))
        top_features = sorted(importances.items(), key=lambda x: -x[1])[:8]
        log.info("Top features: " + ", ".join(f"{k}={v:.3f}" for k, v in top_features))
    except Exception:
        importances = {}

    # Save model
    os.makedirs(os.path.dirname(output_model), exist_ok=True)
    joblib.dump(pipeline, output_model)
    log.info(f"Model saved → {output_model}")

    # Save metadata
    metadata = {
        "model_name": model_name,
        "n_samples": int(len(df)),
        "features": FEATURES,
        "train_mae_etb": round(train_mae),
        "train_r2": round(train_r2, 4),
        "cv_mae_etb": round(cv_mae) if cv_mae else None,
        "cv_r2": round(cv_r2, 4) if cv_r2 else None,
        "sub_city_distribution": df["sub_city"].value_counts().to_dict(),
        "price_stats": {
            "min": float(y.min()),
            "max": float(y.max()),
            "mean": float(y.mean()),
            "median": float(y.median()),
        },
    }
    os.makedirs(os.path.dirname(output_meta), exist_ok=True)
    with open(output_meta, "w") as f:
        json.dump(metadata, f, indent=2)
    log.info(f"Metadata saved → {output_meta}")

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train rental price prediction model")
    parser.add_argument("--scraped", default=SCRAPED_DATA_PATH)
    parser.add_argument("--seed", default=SEED_DATA_PATH, help="Synthetic seed data path")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--output", default=MODEL_PATH)
    parser.add_argument("--meta", default=METADATA_PATH)
    args = parser.parse_args()

    success = train(args.scraped, args.seed, args.db_url, args.output, args.meta)
    if not success:
        exit(1)
