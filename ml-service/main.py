"""
FastAPI price prediction microservice.

Endpoints:
  POST /predict        — predict monthly rent for a property
  GET  /health         — service + model status
  POST /retrain        — trigger background retraining

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import json
import logging
import os
import subprocess
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(
    title="AA Rental Price Prediction",
    description="Predicts monthly rental price for properties in Addis Ababa",
    version="1.0.0",
)

MODEL_PATH = os.getenv("MODEL_PATH", "models/model.pkl")
METADATA_PATH = os.getenv("METADATA_PATH", "models/metadata.json")

_pipeline = None
_metadata: dict = {}


def load_model():
    global _pipeline, _metadata
    if os.path.exists(MODEL_PATH):
        try:
            _pipeline = joblib.load(MODEL_PATH)
            log.info(f"Model loaded from {MODEL_PATH}")
        except Exception as e:
            log.error(f"Failed to load model: {e}")
            _pipeline = None
    else:
        log.warning(f"No model found at {MODEL_PATH} — using rule-based fallback")

    if os.path.exists(METADATA_PATH):
        with open(METADATA_PATH) as f:
            _metadata = json.load(f)


@app.on_event("startup")
async def startup():
    load_model()


# ---------------------------------------------------------------------------
# Rule-based fallback (Addis Ababa market knowledge)
# ---------------------------------------------------------------------------

# ETB per m² per month for each sub-city (based on market research)
SUBCITY_PRICE_PER_SQM: dict[str, float] = {
    "bole": 900,
    "kirkos": 750,
    "arada": 650,
    "lideta": 580,
    "yeka": 680,
    "nifas silk-lafto": 620,
    "addis ketema": 520,
    "kolfe keranio": 480,
    "gullele": 510,
    "akaky kaliti": 430,
    "other": 580,
}

PROPERTY_TYPE_MULT: dict[str, float] = {
    "villa": 1.45,
    "house": 1.20,
    "apartment": 1.00,
    "condominium": 0.82,
    "other": 1.00,
}

CONDITION_MULT: dict[str, float] = {
    "new_build": 1.30,
    "excellent": 1.18,
    "good": 1.00,
    "fair": 0.85,
    "needs_renovation": 0.70,
}

FURNISHING_MULT: dict[str, float] = {
    "furnished": 1.30,
    "semi_furnished": 1.14,
    "unfurnished": 1.00,
}


def rule_based_predict(req: "PredictRequest") -> dict:
    sub_city_key = (req.subCity or "other").lower().strip()
    price_per_sqm = SUBCITY_PRICE_PER_SQM.get(sub_city_key, SUBCITY_PRICE_PER_SQM["other"])

    base = req.area * price_per_sqm
    base *= PROPERTY_TYPE_MULT.get((req.propertyType or "apartment").lower(), 1.0)
    base *= CONDITION_MULT.get((req.homeCondition or "good").lower(), 1.0)
    base *= FURNISHING_MULT.get((req.furnishing or "unfurnished").lower().replace("-", "_"), 1.0)

    # Bedroom adjustment (2 beds is baseline; add/subtract ~8% per bedroom)
    bedroom_factor = 1.0 + (req.bedrooms - 2) * 0.08
    base *= max(0.70, min(bedroom_factor, 1.80))

    # Amenity bonus (up to +18%)
    amenity_bonus = min(len(req.amenities or []) * 0.03, 0.18)
    base *= (1 + amenity_bonus)

    return {
        "predictedMedian": round(base / 100) * 100,  # round to nearest 100
        "predictedMin": round(base * 0.85 / 100) * 100,
        "predictedMax": round(base * 1.18 / 100) * 100,
        "confidence": "low",
        "source": "rule_based",
    }


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    subCity: str = Field(..., example="Bole")
    propertyType: str = Field(..., example="apartment")
    bedrooms: int = Field(..., ge=1, le=25, example=2)
    bathrooms: int = Field(..., ge=1, le=12, example=1)
    area: float = Field(..., gt=0, le=5000, example=80.0)
    homeCondition: Optional[str] = Field("good", example="good")
    furnishing: Optional[str] = Field("unfurnished", example="unfurnished")
    amenities: Optional[list[str]] = Field(default_factory=list, example=["parking", "security"])


class PredictResponse(BaseModel):
    predictedMin: float
    predictedMax: float
    predictedMedian: float
    confidence: str   # "high" | "medium" | "low"
    source: str       # "model" | "rule_based"
    currency: str = "ETB"
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Feature builder (mirrors train.py)
# ---------------------------------------------------------------------------

KNOWN_SUBCITIES = [
    "bole", "kirkos", "arada", "lideta", "addis ketema",
    "akaky kaliti", "kolfe keranio", "gullele", "nifas silk-lafto", "yeka",
]


def build_feature_row(req: PredictRequest) -> pd.DataFrame:
    sub_city = req.subCity.lower().strip()
    if sub_city not in KNOWN_SUBCITIES:
        sub_city = "other"

    prop_type = req.propertyType.lower().strip()
    if prop_type not in ["apartment", "house", "condominium", "villa"]:
        prop_type = "other"

    condition_map = {
        "new_build": "new_build", "excellent": "excellent",
        "good": "good", "fair": "fair", "needs_renovation": "needs_renovation",
    }
    condition = condition_map.get((req.homeCondition or "good").lower(), "good")

    furn_raw = (req.furnishing or "unfurnished").lower().replace("-", "_")
    furn_map = {"furnished": "furnished", "semi_furnished": "semi_furnished", "unfurnished": "unfurnished"}
    furnishing = furn_map.get(furn_raw, "unfurnished")

    amenities_lower = [a.lower() for a in (req.amenities or [])]

    return pd.DataFrame([{
        "area_m2": float(req.area),
        "bedrooms": int(req.bedrooms),
        "bathrooms": int(req.bathrooms),
        "sub_city": sub_city,
        "property_type": prop_type,
        "home_condition": condition,
        "furnishing": furnishing,
        "amenities_count": len(amenities_lower),
        "has_parking": int(any("parking" in a for a in amenities_lower)),
        "has_generator": int(any("generator" in a for a in amenities_lower)),
        "has_security": int(any("security" in a for a in amenities_lower)),
        "has_elevator": int(any("elevator" in a for a in amenities_lower)),
    }])


# ---------------------------------------------------------------------------
# Confidence scoring
# ---------------------------------------------------------------------------

def compute_confidence(n_samples: int, cv_r2: Optional[float]) -> str:
    if n_samples is None or n_samples < 30:
        return "low"
    if cv_r2 is None:
        return "low"
    if cv_r2 >= 0.70 and n_samples >= 100:
        return "high"
    if cv_r2 >= 0.50 and n_samples >= 50:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if _pipeline is None:
        result = rule_based_predict(req)
        return PredictResponse(
            **result,
            currency="ETB",
            note="Model not yet trained. Using rule-based estimate.",
        )

    try:
        X = build_feature_row(req)
        pred = float(_pipeline.predict(X)[0])

        # Estimate uncertainty using individual tree predictions (Random Forest)
        try:
            trees = _pipeline.named_steps["model"].estimators_
            preprocessor = _pipeline.named_steps["preprocessor"]
            X_transformed = preprocessor.transform(X)
            tree_preds = np.array([tree.predict(X_transformed)[0] for tree in trees])
            std = float(tree_preds.std())
            pred_min = max(0, pred - 1.5 * std)
            pred_max = pred + 1.5 * std
        except Exception:
            pred_min = pred * 0.82
            pred_max = pred * 1.22

        n_samples = _metadata.get("n_samples")
        cv_r2 = _metadata.get("cv_r2")
        confidence = compute_confidence(n_samples, cv_r2)

        # If confidence is low, blend with rule-based
        if confidence == "low":
            rule = rule_based_predict(req)
            blend = 0.5
            pred = pred * blend + rule["predictedMedian"] * (1 - blend)
            pred_min = pred_min * blend + rule["predictedMin"] * (1 - blend)
            pred_max = pred_max * blend + rule["predictedMax"] * (1 - blend)

        return PredictResponse(
            predictedMedian=round(pred / 100) * 100,
            predictedMin=round(pred_min / 100) * 100,
            predictedMax=round(pred_max / 100) * 100,
            confidence=confidence,
            source="model",
            currency="ETB",
        )

    except Exception as e:
        log.error(f"Prediction error: {e}")
        result = rule_based_predict(req)
        return PredictResponse(
            **result,
            currency="ETB",
            note="Prediction error, using rule-based fallback.",
        )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": _pipeline is not None,
        "metadata": _metadata,
    }


def _run_retraining(db_url: Optional[str]):
    cmd = ["python", "train.py"]
    if db_url:
        cmd += ["--db-url", db_url]
    if os.path.exists("data/seed_listings.json"):
        cmd += ["--seed", "data/seed_listings.json"]
    log.info(f"Starting retraining: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        log.info("Retraining completed successfully, reloading model...")
        load_model()
    else:
        log.error(f"Retraining failed:\n{result.stderr}")


@app.post("/retrain")
def retrain(background_tasks: BackgroundTasks, db_url: Optional[str] = None):
    env_db_url = db_url or os.getenv("DATABASE_URL")
    background_tasks.add_task(_run_retraining, env_db_url)
    return {"status": "retraining started in background"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
