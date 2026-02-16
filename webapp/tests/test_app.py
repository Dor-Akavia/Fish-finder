"""Tests for the Fish Finder Flask API."""
import json
import os
import pytest
from unittest.mock import patch, MagicMock

# Set test environment variables before importing the app
os.environ["FF_AWS_REGION"] = "eu-north-1"
os.environ["FF_S3_BUCKET"] = "test-bucket"
os.environ["FF_DYNAMODB_TABLE"] = "test-table"
os.environ["FF_COGNITO_POOL_ID"] = "eu-north-1_TestPool"
os.environ["FF_COGNITO_CLIENT_ID"] = "test-client-id"


# Mock boto3 before importing app (app creates clients at import time)
@pytest.fixture(autouse=True)
def mock_aws(monkeypatch):
    """Mock AWS clients that are created at module level in app.py."""
    mock_s3 = MagicMock()
    mock_dynamodb = MagicMock()
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    with patch("app.s3", mock_s3), patch("app.dynamodb", mock_dynamodb), patch("app.table", mock_table):
        yield {"s3": mock_s3, "dynamodb": mock_dynamodb, "table": mock_table}


@pytest.fixture
def client():
    """Create a Flask test client."""
    # Import here so env vars and mocks are already set
    from app import app

    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def auth_header():
    """Return a mock Authorization header that bypasses JWT verification."""
    return {"Authorization": "Bearer mock-valid-token"}


@pytest.fixture(autouse=True)
def mock_auth(monkeypatch):
    """Mock JWT verification to always succeed in tests."""
    import app as app_module

    monkeypatch.setattr(app_module, "verify_token", lambda token: {"sub": "test-user-id", "email": "test@test.com"})


# --------------------------------------------------------------------------
# GET /api/config (public, no auth)
# --------------------------------------------------------------------------
class TestGetConfig:
    def test_returns_cognito_config(self, client):
        resp = client.get("/api/config")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["region"] == "eu-north-1"
        assert data["pool_id"] == "eu-north-1_TestPool"
        assert data["client_id"] == "test-client-id"

    def test_no_auth_required(self, client):
        resp = client.get("/api/config")
        assert resp.status_code == 200


# --------------------------------------------------------------------------
# GET /api/upload-url (auth required)
# --------------------------------------------------------------------------
class TestGetUploadUrl:
    def test_returns_401_without_token(self, client, mock_auth):
        """Verify that missing auth header returns 401."""
        # Temporarily restore real verify_token to test auth rejection

        resp = client.get("/api/upload-url")
        assert resp.status_code == 401

    def test_returns_presigned_url(self, client, auth_header, mock_aws):
        mock_aws["s3"].generate_presigned_post.return_value = {
            "url": "https://test-bucket.s3.amazonaws.com/",
            "fields": {"key": "uploads/test.jpg", "policy": "abc123"},
        }
        resp = client.get("/api/upload-url?filename=fish.jpg", headers=auth_header)
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "image_id" in data
        assert data["image_id"].startswith("uploads/")
        assert data["image_id"].endswith(".jpg")
        assert "upload_url" in data
        assert "fields" in data

    def test_preserves_file_extension(self, client, auth_header, mock_aws):
        mock_aws["s3"].generate_presigned_post.return_value = {
            "url": "https://test-bucket.s3.amazonaws.com/",
            "fields": {},
        }
        resp = client.get("/api/upload-url?filename=photo.png", headers=auth_header)
        data = json.loads(resp.data)
        assert data["image_id"].endswith(".png")

    def test_defaults_to_jpg(self, client, auth_header, mock_aws):
        mock_aws["s3"].generate_presigned_post.return_value = {
            "url": "https://test-bucket.s3.amazonaws.com/",
            "fields": {},
        }
        resp = client.get("/api/upload-url", headers=auth_header)
        data = json.loads(resp.data)
        assert data["image_id"].endswith(".jpg")


# --------------------------------------------------------------------------
# GET /api/results/<image_id> (auth required)
# --------------------------------------------------------------------------
class TestGetResults:
    def test_returns_401_without_token(self, client):
        resp = client.get("/api/results/uploads/test.jpg")
        assert resp.status_code == 401

    def test_returns_pending_when_not_ready(self, client, auth_header, mock_aws):
        mock_aws["table"].get_item.return_value = {}
        resp = client.get("/api/results/uploads/test.jpg", headers=auth_header)
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["status"] == "pending"

    def test_returns_ready_with_result(self, client, auth_header, mock_aws):
        mock_aws["table"].get_item.return_value = {
            "Item": {
                "ImageId": "uploads/test.jpg",
                "Species": "Sparus aurata",
                "HebrewName": "דניס (צ׳יפורה)",
                "NativeStatus": "מקומי",
                "Population": "נפוץ מאוד",
                "AvgSizeCM": 35,
                "MinSizeCM": 0,
                "SeasonalBan": False,
                "Notes": "מין נפוץ",
                "Description": "דג מהספרוסיים",
            }
        }
        resp = client.get("/api/results/uploads/test.jpg", headers=auth_header)
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["status"] == "ready"
        assert data["species"] == "Sparus aurata"
        assert data["hebrew_name"] == "דניס (צ׳יפורה)"
        assert data["avg_size_cm"] == 35
        assert data["seasonal_ban"] is False
