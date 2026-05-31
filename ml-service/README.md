---
title: AA Rental Price Prediction
emoji: 🏠
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
---

# AA Rental Management — Price Prediction Service

FastAPI microservice that predicts fair monthly rent ranges for residential properties in Addis Ababa, Ethiopia.

Used by authority reviewers (admin, dara_agent) to verify landlord-listed prices against the expected market range.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/predict` | Predict price range for a property |
| `GET` | `/health` | Service + model status |
| `POST` | `/retrain` | Trigger model retraining (uses DB if `DATABASE_URL` set) |

## Predict request body

```json
{
  "subCity": "Bole",
  "propertyType": "apartment",
  "bedrooms": 2,
  "bathrooms": 1,
  "area": 80.0,
  "homeCondition": "good",
  "furnishing": "semi_furnished",
  "amenities": ["parking", "security"]
}
```

## Model

- Algorithm: Gradient Boosting Regressor (scikit-learn)
- Training data: 29 scraped Engocha.com listings + 350 synthetic seed samples
- Top features: area (m²), home condition, sub-city, amenities
