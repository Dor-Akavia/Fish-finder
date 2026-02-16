"""
config.py - AWS configuration for the Fish Finder webapp.

All values are read from environment variables set by setup_webapp.sh.
For local development, export them manually or add to a .env file:

    export FF_AWS_REGION="eu-north-1"
    export FF_S3_BUCKET="fish-finder-uploads-xxxx"        # terraform output uploads_bucket_name
    export FF_COGNITO_POOL_ID="eu-north-1_XXXXXXXXX"      # terraform output cognito_user_pool_id
"""
import os

# AWS region (must match the region used in infrastracture/)
AWS_REGION = os.environ.get("FF_AWS_REGION", "eu-north-1")

# S3 bucket where images are uploaded (from Terraform output: uploads_bucket_name)
S3_BUCKET = os.environ.get("FF_S3_BUCKET", "fish-finder-uploads-20260212144935998800000001")

# DynamoDB table where ML results are stored
DYNAMODB_TABLE = os.environ.get("FF_DYNAMODB_TABLE", "fish-finder-results")

# Cognito User Pool ID (from Terraform output: cognito_user_pool_id)
# Used to verify JWT tokens sent by the frontend/mobile app.
COGNITO_POOL_ID = os.environ.get("FF_COGNITO_POOL_ID", "PASTE_YOUR_POOL_ID")

# Cognito App Client ID for the webapp (from Terraform output: cognito_webapp_client_id)
# The frontend uses this to authenticate users via the Cognito SDK.
COGNITO_CLIENT_ID = os.environ.get("FF_COGNITO_CLIENT_ID", "PASTE_YOUR_CLIENT_ID")

# Cognito JWKS URL - used to fetch public keys for JWT signature verification
# Format is always: https://cognito-idp.<region>.amazonaws.com/<pool_id>/.well-known/jwks.json
COGNITO_JWKS_URL = (
    f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_POOL_ID}/.well-known/jwks.json"
)

# Presigned URL expiry - how long the upload URL stays valid (seconds)
PRESIGNED_URL_EXPIRY_SECONDS = 300  # 5 minutes

# How long the webapp waits for results before giving up (seconds)
# Must be longer than the SQS visibility timeout (60s) + ML inference time (~10s)
RESULT_POLL_TIMEOUT_SECONDS = 120
