#!/bin/bash
# =============================================================================
# build_and_push.sh - Build the Lambda container image and push to ECR
#
# Usage: bash build_and_push.sh <ECR_REPO_URL>
# =============================================================================

set -e

# --- Configuration ---
REGION="eu-north-1"
REPO_NAME="fish-finder-ml-worker"

# Get the directory where THIS script is located (the 'lambda' folder)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🚀 Fish Finder - Lambda Build & Push"
echo "=========================================="
echo "Current Directory: $(pwd)"

# 1. Get AWS Account ID and ECR URL
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

# 2. Authenticate with ECR
echo "[1/4] Logging in to Amazon ECR..."
aws ecr get-login-password --region ${REGION} | \
    docker login --username AWS --password-stdin ${ECR_URL}

# 3. Build the Image
echo "[2/4] Building Docker image..."
# We are IN the 'lambda' folder. 
# -f Dockerfile (points to the file right here)
# context '..' (one level up) so Docker can see /scripts and /models
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --output type=docker \
  -t ${REPO_NAME}:latest \
  -f Dockerfile ..

# 4. Tag and Push
echo "[3/4] Tagging image..."
docker tag ${REPO_NAME}:latest ${ECR_URL}:latest

echo "[4/4] Pushing to ECR..."
docker push ${ECR_URL}:latest

echo ""
echo "✅ Done! Your image is now at: ${ECR_URL}:latest"
echo "Now run 'terraform apply' to deploy the update."