"""
lambda_handler.py - Fish Finder Lambda Worker

Serverless replacement for ec2_worker.py.
Triggered by SQS (see lambda.tf - aws_lambda_event_source_mapping).

One Lambda invocation = one SQS message = one fish image processed.
SQS handles retries automatically on failure (no polling loop needed).

Environment variables (set in lambda.tf):
    TABLE_NAME      - DynamoDB results table name
    SNS_TOPIC_ARN   - SNS topic ARN for notifications
    AWS_REGION_NAME - AWS region (avoid conflict with Lambda's built-in AWS_REGION)
"""
import json
import os
import boto3
from pathlib import Path
from urllib.parse import unquote_plus

# model_logic and fish_dictionary are in the same directory in the container
from model_logic import FishClassifier

# --- Configuration from Lambda environment variables ---
TABLE_NAME    = os.environ["TABLE_NAME"]
SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
AWS_REGION    = os.environ.get("AWS_REGION_NAME", "eu-north-1")

# AWS clients (initialised outside the handler = reused across warm invocations)
s3       = boto3.client("s3",       region_name=AWS_REGION)
sns      = boto3.client("sns",      region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table    = dynamodb.Table(TABLE_NAME)

# Load the ML model once at container startup (cold start ~10-15s, warm ~0s)
print("[Lambda] Loading FishClassifier model...")
classifier = FishClassifier()
print("[Lambda] Model ready.")


def handler(event, context):
    """
    Lambda entry point. Called once per SQS batch (batch_size=1 in lambda.tf).

    If this function raises an exception, SQS will make the message visible
    again for retry (up to maximum_retry_attempts set in the event source mapping).
    """
    print(f"[Lambda] Received event with {len(event['Records'])} record(s)")

    for record in event["Records"]:
        process_record(record)

    return {"statusCode": 200, "body": "OK"}


def process_record(record):
    """Process a single SQS record containing an S3 event notification."""
    body = json.loads(record["body"])

    # SQS sometimes wraps S3 events in an SNS envelope
    if "Message" in body:
        body = json.loads(body["Message"])

    if "Records" not in body:
        print(f"[Lambda] Skipping unrecognised message: {list(body.keys())}")
        return

    s3_record = body["Records"][0]["s3"]
    bucket    = s3_record["bucket"]["name"]
    # S3 event notifications URL-encode the key (spaces → +, special chars → %XX)
    key       = unquote_plus(s3_record["object"]["key"])
    print(f"[Lambda] Processing: s3://{bucket}/{key}")

    # Download image to /tmp (Lambda ephemeral storage, max 512MB by default)
    tmp_path = f"/tmp/{Path(key).name}"
    print(f"[Lambda]   Downloading to {tmp_path}...")
    s3.download_file(bucket, key, tmp_path)

    try:
        # Run ML inference and get confidence score for logging
        print("[Lambda]   Running inference...")
        species_en, data, confidence = classifier.predict(tmp_path)
        print(f"[Lambda]   Result: {species_en} (confidence: {confidence:.1%})")
    finally:
        # Clean up /tmp to avoid filling the 512MB limit across warm invocations
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    # Format min_size: show Hebrew "no minimum" when None, otherwise "<N> cm"
    raw_min_size = data["regulations"]["min_size_cm"]
    min_size_display = "אין גודל מינימלי" if raw_min_size is None else f"{raw_min_size} ס״מ"

    # Save result to DynamoDB - ImageId is the primary key polled by the webapp
    print("[Lambda]   Writing to DynamoDB...")
    table.put_item(Item={
        "ImageId":      key,
        "Species":      species_en,
        "HebrewName":   data["name"],
        "NativeStatus": data["native_status"],
        "Population":   data["population_status"],
        "AvgSizeCM":    data["avg_size_cm"],
        "MinSizeCM":    raw_min_size if raw_min_size is not None else 0,
        "MinSizeDisplay": min_size_display,
        "SeasonalBan":  data["regulations"]["seasonal_ban"],
        "Notes":        data["regulations"]["notes"],
        "Description":  data["description"],
        "Confidence":   str(round(confidence, 4)),
        "NeedsReview":  confidence < 0.70,
    })

    # Publish Hebrew notification via SNS
    ban_status   = "פעיל" if data["regulations"]["seasonal_ban"] else "לא פעיל"
    conf_str     = f"{confidence:.0%}"
    message_text = (
        f"זיהוי: {data['name']} ({species_en}) - ביטחון: {conf_str}\n"
        f"סטטוס: {data['native_status']} | {data['population_status']}\n"
        f"גודל מינימלי: {min_size_display}\n"
        f"איסור עונתי: {ban_status}\n"
        f"הערות: {data['regulations']['notes']}"
    )
    print("[Lambda]   Sending SNS notification...")
    sns.publish(
        TopicArn=SNS_TOPIC_ARN,
        Message=message_text,
        Subject=f"תוצאה: {data['name']}"
    )

    print(f"[Lambda] ✅ Done: {key} → {species_en}")
