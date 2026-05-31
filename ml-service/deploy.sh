#!/usr/bin/env bash
# Deploy the ML service to Hugging Face Spaces.
# Usage: bash deploy.sh <hf-username> <space-name> <hf-token>
# Example: bash deploy.sh yuhe5 aa-rental-predict hf_abcXYZ...

set -e

HF_USER="${1:?Usage: bash deploy.sh <hf-username> <space-name> <hf-token>}"
SPACE_NAME="${2:?Usage: bash deploy.sh <hf-username> <space-name> <hf-token>}"
HF_TOKEN="${3:?Usage: bash deploy.sh <hf-username> <space-name> <hf-token>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Deploying to HF Space: ${HF_USER}/${SPACE_NAME}"

python3 - <<EOF
from huggingface_hub import HfApi

api = HfApi()
api.upload_folder(
    folder_path="${SCRIPT_DIR}",
    repo_id="${HF_USER}/${SPACE_NAME}",
    repo_type="space",
    token="${HF_TOKEN}",
    ignore_patterns=[
        "*.pyc", "**/__pycache__/**", "**/.venv/**", ".venv",
        "data/scrape.log", "deploy.sh",
    ],
    commit_message="Deploy AA Rental Price Prediction service",
)
print("✅ Done!")
print(f"   Space:   https://huggingface.co/spaces/${HF_USER}/${SPACE_NAME}")
print(f"   API URL: https://${HF_USER}-${SPACE_NAME}.hf.space")
print()
print("   Set this in your Render NestJS environment variables:")
print(f"   ML_SERVICE_URL=https://${HF_USER}-${SPACE_NAME}.hf.space")
EOF
