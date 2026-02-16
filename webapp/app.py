"""
app.py - Fish Finder Web API Server

Provides a REST API that:
  1. Generates presigned S3 upload URLs so clients upload directly to S3
     (no image data passes through this server - efficient for mobile too)
  2. Polls DynamoDB for ML results keyed by the S3 image ID

The same API endpoints will be called by:
  - This web frontend (index.html)
  - Future native iOS / Android apps

Run locally:
    pip install -r requirements.txt
    python app.py

Then open http://localhost:5000 in your browser.
"""

import uuid
import functools
import requests
import boto3
import botocore
from jose import jwt, JWTError
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import config

# ---------------------------------------------------------------------------
# JWT verification (Cognito)
# ---------------------------------------------------------------------------
# Fetch Cognito's public keys once at startup and cache them.
# These are used to verify the signature of every JWT sent by clients.
_jwks_cache = None


def _get_jwks():
    """Fetch and cache Cognito's JSON Web Key Set."""
    global _jwks_cache
    if _jwks_cache is None:
        print(f"[Auth] Fetching JWKS from {config.COGNITO_JWKS_URL}")
        resp = requests.get(config.COGNITO_JWKS_URL, timeout=5)
        resp.raise_for_status()
        _jwks_cache = resp.json()["keys"]
    return _jwks_cache


def verify_token(token: str) -> dict:
    """
    Verify a Cognito JWT and return the decoded claims.
    Raises JWTError if the token is invalid or expired.
    """
    # Decode without verification first to extract the key ID (kid)
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header["kid"]

    # Find the matching public key in the JWKS
    jwks = _get_jwks()
    public_key = next((k for k in jwks if k["kid"] == kid), None)
    if not public_key:
        raise JWTError(f"Public key not found for kid: {kid}")

    # Verify signature, expiry, and audience
    claims = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        options={"verify_aud": False},  # Cognito ID tokens don't use 'aud' in all flows
    )
    return claims


def require_auth(f):
    """
    Decorator that enforces Cognito JWT authentication on an endpoint.
    Clients must send: Authorization: Bearer <id_token>
    """

    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth_header[len("Bearer ") :]
        try:
            request.user = verify_token(token)
        except JWTError as e:
            print(f"[Auth] Token rejected: {e}")
            return jsonify({"error": "Invalid or expired token"}), 401
        return f(*args, **kwargs)

    return decorated


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder="static", static_url_path="")

# Allow cross-origin requests so native mobile webviews / React Native apps
# can call this API from a different origin.
CORS(app)

# AWS clients - initialised once at startup
s3 = boto3.client("s3", region_name=config.AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=config.AWS_REGION)
table = dynamodb.Table(config.DYNAMODB_TABLE)

print("[Fish Finder API] Starting up")
print(f"  Region:       {config.AWS_REGION}")
print(f"  S3 Bucket:    {config.S3_BUCKET}")
print(f"  DynamoDB:     {config.DYNAMODB_TABLE}")
print(f"  Cognito Pool: {config.COGNITO_POOL_ID}")
print(f"  Cognito App:  {config.COGNITO_CLIENT_ID}")


# ---------------------------------------------------------------------------
# Serve the frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    """Serve the single-page web UI."""
    return send_from_directory(app.static_folder, "index.html")


# ---------------------------------------------------------------------------
# API: Cognito config (public - no auth required)
# ---------------------------------------------------------------------------
@app.route("/api/config")
def get_config():
    """
    Returns the Cognito identifiers so the frontend can initialise
    the auth SDK without hardcoding values.

    This endpoint is intentionally NOT protected by @require_auth
    because the frontend needs this data BEFORE the user has logged in.
    None of these values are secret - they're safe to expose publicly
    (Cognito security relies on the password, not on hiding the pool ID).
    """
    return jsonify(
        {
            "region": config.AWS_REGION,
            "pool_id": config.COGNITO_POOL_ID,
            "client_id": config.COGNITO_CLIENT_ID,
        }
    )


# ---------------------------------------------------------------------------
# API: Generate a presigned S3 upload URL
# ---------------------------------------------------------------------------
@app.route("/api/upload-url")
@require_auth
def get_upload_url():
    """
    Generate a presigned S3 POST URL so the client uploads directly to S3.

    Query params:
        filename (str): Original filename from the user (e.g. "my_fish.jpg")

    Response JSON:
        {
          "image_id":   "uploads/uuid4.jpg",   <- use this to poll for results
          "upload_url": "https://s3.amazonaws.com/...",
          "fields":     { ... }                <- POST these fields with the file
        }

    The client must POST a multipart/form-data request to upload_url with
    all the 'fields' included plus the 'file' field containing the image bytes.
    """
    filename = request.args.get("filename", "image.jpg")

    # Strip any path components for safety, keep the file extension
    safe_name = filename.split("/")[-1].split("\\")[-1]
    extension = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else "jpg"

    # Use a UUID as the S3 key to avoid collisions and make polling unambiguous
    image_id = f"uploads/{uuid.uuid4()}.{extension}"

    print(f"[API] Generating presigned URL for: {image_id}")

    try:
        presigned = s3.generate_presigned_post(
            Bucket=config.S3_BUCKET,
            Key=image_id,
            ExpiresIn=config.PRESIGNED_URL_EXPIRY_SECONDS,
        )
        return jsonify(
            {
                "image_id": image_id,
                "upload_url": presigned["url"],
                "fields": presigned["fields"],
            }
        )
    except botocore.exceptions.ClientError as e:
        print(f"[API] ❌ Failed to generate presigned URL: {e}")
        return jsonify(
            {
                "error": "Could not generate upload URL. Check AWS credentials and S3 bucket config."
            }
        ), 500


# ---------------------------------------------------------------------------
# API: Poll for ML results
# ---------------------------------------------------------------------------
@app.route("/api/results/<path:image_id>")
@require_auth
def get_results(image_id):
    """
    Poll DynamoDB for the ML result for a given image.

    Path param:
        image_id (str): The S3 key returned by /api/upload-url

    Response JSON (pending):
        { "status": "pending" }

    Response JSON (ready):
        {
          "status":       "ready",
          "species":      "Sparus aurata",
          "hebrew_name":  "דניס (צ׳יפורה)",
          "native":       "מקומי (גם מגודל בחקלאות ימית)",
          "population":   "נפוץ",
          "avg_size_cm":  50,
          "min_size_cm":  20,
          "seasonal_ban": false,
          "notes":        "...",
          "description":  "..."
        }

    The client should poll this endpoint every few seconds until status == "ready".
    """
    print(f"[API] Polling results for: {image_id}")

    try:
        response = table.get_item(Key={"ImageId": image_id})
    except botocore.exceptions.ClientError as e:
        print(f"[API] ❌ DynamoDB error: {e}")
        return jsonify({"error": "Could not query results database."}), 500

    if "Item" not in response:
        # Worker hasn't processed it yet - client should keep polling
        return jsonify({"status": "pending"})

    item = response["Item"]

    # Safe conversion helper to handle NoneType values from DynamoDB
    def safe_int(val, default=0):
        return int(val) if val is not None else default

    return jsonify(
        {
            "status": "ready",
            "species": item.get("Species", ""),
            "hebrew_name": item.get("HebrewName", ""),
            "native": item.get("NativeStatus", ""),
            "population": item.get("Population", ""),
            "avg_size_cm": safe_int(item.get("AvgSizeCM")),
            "min_size_cm": safe_int(item.get("MinSizeCM")),
            "seasonal_ban": bool(item.get("SeasonalBan", False)),
            "notes": item.get("Notes", ""),
            "description": item.get("Description", ""),
        }
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # debug=True enables auto-reload on code changes during development.
    # Set debug=False (or use a proper WSGI server like gunicorn) in production.
    app.run(host="0.0.0.0", port=5000, debug=True)
