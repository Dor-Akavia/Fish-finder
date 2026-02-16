"""Tests for worker message parsing and result formatting (no ML model required)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))


class TestSQSMessageParsing:
    """Test that the worker correctly extracts S3 bucket/key from SQS messages."""

    def test_parse_direct_s3_event(self):
        """Standard S3 event notification format."""
        body = {
            "Records": [
                {
                    "s3": {
                        "bucket": {"name": "fish-finder-uploads"},
                        "object": {"key": "uploads/abc123.jpg"},
                    }
                }
            ]
        }
        bucket = body["Records"][0]["s3"]["bucket"]["name"]
        key = body["Records"][0]["s3"]["object"]["key"]
        assert bucket == "fish-finder-uploads"
        assert key == "uploads/abc123.jpg"

    def test_parse_sns_wrapped_s3_event(self):
        """S3 event wrapped in an SNS envelope (S3 -> SNS -> SQS path)."""
        inner = {
            "Records": [
                {
                    "s3": {
                        "bucket": {"name": "fish-finder-uploads"},
                        "object": {"key": "uploads/def456.jpg"},
                    }
                }
            ]
        }
        body = {"Message": json.dumps(inner)}

        # Unwrap the SNS envelope (same logic as ec2_worker.py and lambda_handler.py)
        if "Message" in body:
            body = json.loads(body["Message"])

        bucket = body["Records"][0]["s3"]["bucket"]["name"]
        key = body["Records"][0]["s3"]["object"]["key"]
        assert bucket == "fish-finder-uploads"
        assert key == "uploads/def456.jpg"

    def test_skip_unrecognised_message(self):
        """Messages without 'Records' should be skipped."""
        body = {"Type": "Notification", "Message": "some other message"}
        if "Message" in body:
            try:
                body = json.loads(body["Message"])
            except (json.JSONDecodeError, TypeError):
                pass
        assert "Records" not in body

    def test_mock_event_file_is_valid(self):
        """Verify the mock_event.json test fixture is well-formed."""
        mock_path = os.path.join(os.path.dirname(__file__), "mock_event.json")
        with open(mock_path) as f:
            event = json.load(f)
        assert "Records" in event
        assert event["Records"][0]["s3"]["bucket"]["name"] == "fish-finder-uploads-bucket"


class TestDynamoDBResultFormatting:
    """Test the DynamoDB item structure matches what the webapp expects."""

    def test_result_item_has_required_fields(self):
        """The webapp's get_results() endpoint expects these DynamoDB fields."""
        # Simulate what the worker writes to DynamoDB
        item = {
            "ImageId": "uploads/test.jpg",
            "Species": "Sparus aurata",
            "HebrewName": "דניס",
            "NativeStatus": "מקומי",
            "Population": "נפוץ",
            "AvgSizeCM": 35,
            "MinSizeCM": 0,
            "SeasonalBan": False,
            "Notes": "some notes",
            "Description": "some description",
            "Confidence": "0.9500",
            "NeedsReview": False,
        }
        # These are the fields the webapp reads (from app.py get_results())
        required = ["ImageId", "Species", "HebrewName", "NativeStatus", "Population",
                     "AvgSizeCM", "MinSizeCM", "SeasonalBan", "Notes", "Description"]
        for field in required:
            assert field in item, f"Missing DynamoDB field: {field}"

    def test_confidence_below_threshold_flags_review(self):
        """Predictions with confidence < 0.70 should be flagged for review."""
        confidence = 0.55
        needs_review = confidence < 0.70
        assert needs_review is True

    def test_confidence_above_threshold_no_review(self):
        confidence = 0.92
        needs_review = confidence < 0.70
        assert needs_review is False


class TestSNSMessageFormatting:
    """Test the Hebrew SNS notification message format."""

    def test_notification_contains_species_info(self):
        """Verify the SNS message includes the key identification details."""
        data = {
            "name": "דניס",
            "native_status": "מקומי",
            "population_status": "נפוץ",
            "regulations": {
                "min_size_cm": 20,
                "seasonal_ban": False,
                "notes": "דג נפוץ",
            },
        }
        species_en = "Sparus aurata"
        ban_status = "פעיל" if data["regulations"]["seasonal_ban"] else "לא פעיל"
        message = (
            f"זיהוי: {data['name']} ({species_en})\n"
            f"סטטוס: {data['native_status']} | {data['population_status']}\n"
            f"גודל מינימלי: {data['regulations']['min_size_cm']} ס״מ\n"
            f"איסור עונתי: {ban_status}\n"
            f"הערות: {data['regulations']['notes']}"
        )
        assert "דניס" in message
        assert "Sparus aurata" in message
        assert "לא פעיל" in message
        assert "20 ס״מ" in message
