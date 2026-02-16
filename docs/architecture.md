# System Architecture

Fish Finder is a serverless-leaning, event-driven system built on AWS (eu-north-1). Users upload a fish photograph; an ML pipeline identifies the species and returns the Hebrew name, fishing regulations, and population status.

---

## Component Overview

| Component | Technology | Role |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Single-page upload UI, result polling |
| CDN | CloudFront | HTTPS termination, caching, geographic distribution |
| Static hosting | S3 (`frontend` bucket) | Hosts the compiled static site |
| REST API | Flask on EC2 | Generates presigned upload URLs, polls DynamoDB for results |
| Image storage | S3 (`uploads` bucket) | Receives fish photos directly from the browser |
| Message queue | SQS | Decouples upload events from ML processing |
| ML worker (current) | EC2 t3.micro | Long-polls SQS, runs PyTorch inference |
| ML worker (future) | Lambda container | Replaces EC2 worker; triggered directly by SQS |
| ML model | PyTorch MobileNetV2 | 20-class classifier trained on Mediterranean fish species |
| Results store | DynamoDB | Key-value store for completed inference results |
| Notifications | SNS | Publishes Hebrew-language result summaries (SMS/email) |
| Authentication | Cognito User Pool | Issues JWTs for browser and mobile clients |
| Mobile app (future) | React Native + Expo | Planned iOS/Android companion app (not yet active) |
| Infrastructure | Terraform | All resources declared as code (eu-north-1) |

---

## Why These Services Were Chosen

**SQS over direct Lambda trigger from S3**
S3 → SQS → worker allows the pipeline to absorb traffic spikes without dropping events. SQS also provides at-least-once delivery with configurable visibility timeouts and dead-letter queue support.

**EC2 t3.micro for the current worker**
PyTorch with CPU-only wheels requires approximately 1.5 GB of RAM at load time. A t3.micro (1 GB RAM) is supplemented with a 2 GB swap file. The long-poll loop keeps the instance continuously busy without paying for Lambda cold-start time during development.

**Lambda container image as the future worker**
Lambda container images remove the 250 MB zip size limit, making it possible to package PyTorch (~200 MB CPU wheels) and the model weights together. Lambda scales to zero when idle and scales out automatically under load, eliminating the cost of a permanently running EC2 instance.

**MobileNetV2**
MobileNetV2 is a lightweight architecture designed for inference on resource-constrained hardware. Its depthwise separable convolutions run efficiently on CPU, which matters both for the t3.micro worker and for any future on-device inference.

**CloudFront in front of both S3 and Flask**
A single CloudFront distribution routes static asset requests to the S3 frontend bucket and API requests to the Flask EC2 instance. This provides HTTPS, caching for static content, and a single public hostname for the application.

**Cognito User Pool**
Cognito handles the full auth lifecycle (sign-up, email verification, sign-in, token refresh) without requiring a custom auth service. The User Pool has separate app clients (webapp and mobile) so client credentials can be rotated independently. The mobile app client is provisioned for future use.

---

## Full Data Flow

### Upload and Identification Flow

```
Browser
        │
        │ 1. GET /api/upload-url?filename=fish.jpg
        │    (Authorization: Bearer <JWT>)
        ▼
  Flask API (EC2)
        │
        │ 2. Generates presigned S3 POST
        │    Returns: { image_id, upload_url, fields }
        ▼
Browser
        │
        │ 3. POST multipart/form-data directly to S3
        │    (fields + file — no image bytes through Flask)
        ▼
  S3 uploads bucket
        │
        │ 4. S3 Event Notification → SQS message
        ▼
  SQS Queue (fish-finder-queue)
        │
        │ 5a. EC2 worker long-polls (WaitTimeSeconds=20)
        │   OR
        │ 5b. Lambda invoked by SQS trigger (future)
        ▼
  ML Worker
        │
        │ 6. Downloads image from S3 to /tmp
        │ 7. Runs MobileNetV2 inference
        │    → species name (English + Hebrew)
        │    → regulations (min size, seasonal ban)
        │    → population status
        │
        │ 8. Writes result to DynamoDB (key = S3 image key)
        │ 9. Publishes Hebrew summary to SNS
        ▼
  DynamoDB (fish-finder-results)
        ▲
        │
        │ 10. Browser polls GET /api/results/<image_id>
        │     every 3 seconds until status == "ready"
        │
  Flask API (EC2) ◄── Browser
```

### Auth Flow

```
  Browser
         │
         │ 1. Sign in with email + password (SRP auth)
         ▼
  Cognito User Pool
         │
         │ 2. Returns ID token + access token (1-hour TTL)
         │    + refresh token (30-day TTL)
         ▼
  Browser
         │
         │ 3. Attaches JWT to every API call:
         │    Authorization: Bearer <id_token>
         ▼
  Flask API (EC2)
         │
         │ 4. Verifies JWT signature against Cognito JWKS endpoint
         │    Checks: issuer, audience (client_id), expiry
         │
         │ 5. If valid → serves the request
         │    If invalid → 401 Unauthorized
```

---

## Worker Modes

### Mode 1: EC2 Long-Poll Worker (Current)

The EC2 instance runs `ec2_worker.py` as a systemd service. The script enters an infinite loop, calling `sqs.receive_message` with `WaitTimeSeconds=20`. When a message arrives, it downloads the image, runs inference, writes to DynamoDB, notifies via SNS, then deletes the SQS message.

Advantages:
- Simple to debug — SSH in and tail `journalctl`
- Model is loaded once at startup; no cold starts per message
- Low cost for development-scale traffic

Limitations:
- Always-on cost even when idle
- Vertical scaling only (larger instance type)
- Manual deployment for model updates

### Mode 2: Lambda Container Worker (Future)

A Docker image containing Python 3.11, PyTorch CPU wheels, the model weights, and `lambda_handler.py` is stored in ECR. The Lambda function (`fish-finder-ml-worker`) is configured with 1536 MB memory and a 300-second timeout. An SQS event source mapping with `batch_size=1` triggers one Lambda invocation per image.

To switch:
1. Build and push the container image (see `docs/deployment.md`)
2. In `infrastracture/lambda.tf`, set `aws_lambda_event_source_mapping.sqs_trigger.enabled = true`
3. Decommission the EC2 worker: `sudo systemctl disable fish-finder-worker`

Advantages:
- Scales to zero when idle (no cost)
- Scales out automatically under load
- Built-in retry and dead-letter queue support

Limitations:
- Cold starts (first invocation loads PyTorch + model weights)
- Memory limit means the model must stay within ~1.5 GB

---

## Deployment Topology

```
eu-north-1
├── VPC
│   ├── Public subnet
│   │   ├── EC2 t3.micro  (ML Worker)    — security group: SQS/DynamoDB/SNS outbound only
│   │   └── EC2 t3.micro  (Flask API)    — security group: 80/443 inbound, AWS outbound
│   └── (Lambda runs outside VPC for simplicity)
│
├── S3
│   ├── fish-finder-uploads-<suffix>     (fish images, private)
│   └── fish-finder-frontend-<suffix>    (static site, CloudFront-accessible)
│
├── CloudFront
│   └── Distribution → S3 (static) + EC2 ALB (API)
│
├── SQS  fish-finder-queue
├── SNS  fish-finder-alerts
├── DynamoDB  fish-finder-results
├── Cognito  fish-finder-users
│   ├── App client: fish-finder-webapp
│   └── App client: fish-finder-mobile  (provisioned for future mobile app)
├── Lambda  fish-finder-ml-worker (container, disabled trigger)
├── ECR    fish-finder-ml-worker
└── S3     fish-tf-state  (Terraform remote state)
   DynamoDB  fish-tf-locks  (Terraform state locking)
```

---

## Security Considerations

- Images are uploaded directly to S3 via presigned POST URLs. Image bytes never pass through the Flask API, keeping the API EC2 instance lean and reducing attack surface.
- Presigned URLs expire after 5 minutes (`PRESIGNED_URL_EXPIRY_SECONDS = 300`).
- The S3 uploads bucket is private; only the API EC2 role and worker EC2 role can read objects.
- Worker environment variables (`QUEUE_URL`, `SNS_ARN`) are stored in a `chmod 600` `.env` file on the EC2 instance and injected via systemd `EnvironmentFile` — they never appear in `ps` output or `systemctl status`.
- Cognito tokens have a 1-hour access token TTL with a 30-day refresh token.
- EC2 key pairs (`*.pem`) must be kept out of version control. All `.pem` files are listed in `.gitignore`.
