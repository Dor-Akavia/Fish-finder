import boto3
import json
import os
from model_logic import FishClassifier

# --- CONFIGURATION ---
# These values are injected by setup_env.sh via the systemd EnvironmentFile.
# They must be set before starting the worker.
QUEUE_URL  = os.environ.get("QUEUE_URL")
SNS_ARN    = os.environ.get("SNS_ARN")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")
TABLE_NAME = "fish-finder-results"

# Validate that required env vars are present before doing anything else
if not QUEUE_URL or not SNS_ARN:
    raise EnvironmentError(
        "❌ Missing required environment variables: QUEUE_URL and SNS_ARN\n"
        "   These should be set by setup_env.sh in the systemd EnvironmentFile."
    )

print("--- [EC2] Starting Production Fish-Finder Worker ---")
print(f"    Region:    {AWS_REGION}")
print(f"    Queue:     {QUEUE_URL}")
print(f"    SNS Topic: {SNS_ARN}")
print(f"    DynamoDB:  {TABLE_NAME}")

# Load the ML model once at startup (expensive - do not reload per message)
classifier = FishClassifier()

# AWS clients - all use the same region
sqs      = boto3.client('sqs',      region_name=AWS_REGION)
s3       = boto3.client('s3',       region_name=AWS_REGION)
sns      = boto3.client('sns',      region_name=AWS_REGION)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)


def process_fish():
    """Poll SQS for one message, run ML inference, store result, notify via SNS."""

    # 1. Long Poll SQS (waits up to 20s if queue is empty - saves API cost)
    print("Polling SQS for messages...")
    response = sqs.receive_message(
        QueueUrl=QUEUE_URL,
        WaitTimeSeconds=20,
        MaxNumberOfMessages=1
    )

    if 'Messages' not in response:
        # Perfectly normal - just means the queue was empty during the poll window
        print("No messages this poll cycle.")
        return

    msg  = response['Messages'][0]
    body = json.loads(msg['Body'])

    # SQS sometimes wraps the S3 event in an SNS envelope - handle both formats
    if 'Message' in body:
        # SNS-wrapped format: body['Message'] is a JSON string containing the S3 event
        body = json.loads(body['Message'])

    # Safety check: ensure this is actually an S3 event
    if 'Records' not in body:
        print(f"⚠️  Skipping unrecognised message format: {list(body.keys())}")
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg['ReceiptHandle'])
        return

    bucket   = body['Records'][0]['s3']['bucket']['name']
    key      = body['Records'][0]['s3']['object']['key']
    print(f"📥 Processing: s3://{bucket}/{key}")

    # 2. Download image from S3 to /tmp (ephemeral scratch space)
    tmp_path = f"/tmp/{os.path.basename(key)}"
    print(f"   Downloading to {tmp_path}...")
    s3.download_file(bucket, key, tmp_path)

    # 3. ML Inference
    print("   Running ML inference...")
    species_en, data, confidence = classifier.predict(tmp_path)
    print(f"   Identified: {species_en} ({data['name']}) — confidence: {confidence:.1%}")

    # 4. Save structured result to DynamoDB
    # The 'ImageId' (S3 key) is the primary key - the webapp polls on this
    print("   Saving result to DynamoDB...")
    table = dynamodb.Table(TABLE_NAME)
    table.put_item(Item={
        'ImageId':      key,
        'Species':      species_en,
        'HebrewName':   data['name'],
        'NativeStatus': data['native_status'],
        'Population':   data['population_status'],
        'AvgSizeCM':    data['avg_size_cm'],
        'MinSizeCM':    data['regulations']['min_size_cm'],
        'SeasonalBan':  data['regulations']['seasonal_ban'],
        'Notes':        data['regulations']['notes'],
        'Description':  data['description'],
        # Track model confidence so low-scoring results can be reviewed for retraining
        'Confidence':   str(round(confidence, 4)),
        'NeedsReview':  confidence < 0.70,  # Flag uncertain predictions for dataset improvement
    })

    # 5. Notify via SNS (Hebrew-formatted message for SMS/email subscribers)
    ban_status   = "פעיל" if data['regulations']['seasonal_ban'] else "לא פעיל"
    message_text = (
        f"🐟 זיהוי: {data['name']} ({species_en})\n"
        f"סטטוס: {data['native_status']} | {data['population_status']}\n"
        f"גודל מינימלי: {data['regulations']['min_size_cm']} ס״מ\n"
        f"איסור עונתי: {ban_status}\n"
        f"הערות: {data['regulations']['notes']}"
    )
    print("   Sending SNS notification...")
    sns.publish(
        TopicArn=SNS_ARN,
        Message=message_text,
        Subject=f"תוצאה: {data['name']}"
    )

    # 6. Delete processed message from queue
    sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg['ReceiptHandle'])
    print(f"✅ Done: {key} → {species_en}")


if __name__ == "__main__":
    print("\n🔄 Entering polling loop. Press Ctrl+C to stop.\n")
    while True:
        try:
            process_fish()
        except KeyboardInterrupt:
            print("\n👋 Worker stopped by user.")
            break
        except Exception as e:
            # Log the error but keep the loop running - the message will
            # become visible again in SQS after the visibility timeout expires.
            print(f"❌ Error during processing: {e}")
