# Deployment Guide

This guide walks through a full deployment of Fish Finder from scratch: Terraform state backend, infrastructure provisioning, EC2 worker setup, webapp deployment, and the optional Lambda worker path.

---

## Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| AWS CLI | 2.x | Configured with credentials for the target account |
| Terraform | 1.6+ | |
| Docker | 24+ | Required only for Lambda container builds |
| Python | 3.11+ | For local development and the webapp |
| Bash | Any | `package_worker.sh` and `setup_env.sh` are bash scripts |
| SSH key | — | An EC2 key pair `.pem` file (not committed to git — all `*.pem` files are in `.gitignore`) |

Verify your AWS identity before starting:

```bash
aws sts get-caller-identity
```

---

## Step 1: Create the Terraform State Backend

Terraform stores state remotely in S3 with DynamoDB locking. These resources must exist before `terraform init` can succeed. Create them once per AWS account:

```bash
# Create the state bucket
aws s3api create-bucket \
    --bucket fish-tf-state \
    --region eu-north-1 \
    --create-bucket-configuration LocationConstraint=eu-north-1

# Enable versioning so you can recover from accidental state corruption
aws s3api put-bucket-versioning \
    --bucket fish-tf-state \
    --versioning-configuration Status=Enabled

# Enable server-side encryption
aws s3api put-bucket-encryption \
    --bucket fish-tf-state \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create the DynamoDB locking table
aws dynamodb create-table \
    --table-name fish-tf-locks \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region eu-north-1
```

These names are hard-coded in `infrastracture/backend.tf`. Do not change them without updating that file.

---

## Step 2: Provision Infrastructure with Terraform

```bash
cd infrastracture/

terraform init        # Downloads providers, connects to the S3 backend
terraform plan        # Review what will be created
terraform apply       # Provision all resources (~3-5 minutes)
```

After apply completes, record the output values — they are needed in subsequent steps:

```
worker_public_ip        = "X.X.X.X"
webapp_public_ip        = "X.X.X.X"
sqs_queue_url           = "https://sqs.eu-north-1.amazonaws.com/..."
sns_topic_arn           = "arn:aws:sns:eu-north-1:..."
uploads_bucket_name     = "fish-finder-uploads-..."
frontend_bucket_name    = "fish-finder-frontend-..."
cognito_user_pool_id    = "eu-north-1_..."
cognito_webapp_client_id= "..."
cognito_mobile_client_id= "..."  (provisioned for future mobile app)
cloudfront_url          = "https://xxxxx.cloudfront.net"
ecr_repository_url      = "....dkr.ecr.eu-north-1.amazonaws.com/fish-finder-ml-worker"
```

To re-display outputs at any time:

```bash
terraform output
```

---

## Step 3: Deploy the ML Worker to EC2

### 3a. Package the worker

Run from the **project root** (not from inside `infrastracture/`):

```bash
bash package_worker.sh
```

This validates that all required files exist, then creates `fish_worker.tar.gz` containing:

```
scripts/ec2_worker.py
scripts/model_logic.py
scripts/fish_dictionary.py
models/israel_med_fish_v1.pth
```

### 3b. Transfer files to the EC2 instance

```bash
scp -i <your-key>.pem \
    fish_worker.tar.gz \
    fish-finder-worker/scripts/setup_env.sh \
    ubuntu@<WORKER_PUBLIC_IP>:~/
```

### 3c. Run the setup script on the instance

```bash
ssh -i <your-key>.pem ubuntu@<WORKER_PUBLIC_IP>

# On the EC2 instance:
bash setup_env.sh <SQS_QUEUE_URL> <SNS_TOPIC_ARN>
# Example:
# bash setup_env.sh \
#   https://sqs.eu-north-1.amazonaws.com/123456789/fish-finder-queue \
#   arn:aws:sns:eu-north-1:123456789:fish-finder-alerts
```

The setup script (`setup_env.sh`) performs these steps automatically:

1. Creates a 2 GB swap file (required — t3.micro has 1 GB RAM; PyTorch needs ~1.5 GB)
2. Installs `python3-pip` and `python3-venv`
3. Extracts `fish_worker.tar.gz` to `~/fish-finder-worker/`
4. Creates a Python virtual environment
5. Installs CPU-only PyTorch, torchvision, boto3, and Pillow
6. Writes `~/fish-finder-worker/.env` with `QUEUE_URL` and `SNS_ARN` (mode 600)
7. Installs and starts the `fish-finder-worker` systemd service

### 3d. Verify the worker is running

```bash
sudo systemctl status fish-finder-worker
sudo journalctl -u fish-finder-worker -f     # Follow live logs
```

Expected output when idle:

```
--- [EC2] Starting Production Fish-Finder Worker ---
Polling SQS for messages...
No messages this poll cycle.
Polling SQS for messages...
```

---

## Step 4: Deploy the Flask Webapp

The webapp runs on its own EC2 instance. SSH in using the webapp IP from Terraform outputs:

```bash
ssh -i <your-key>.pem ubuntu@<WEBAPP_PUBLIC_IP>
```

On the instance:

```bash
# Install dependencies
sudo apt-get update && sudo apt-get install -y python3-pip python3-venv git

# Clone or SCP the webapp/ directory onto the instance, then:
cd webapp/
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Set environment variables (or edit webapp/config.py directly)
export FF_S3_BUCKET="<uploads_bucket_name>"
export FF_AWS_REGION="eu-north-1"
export FF_DYNAMODB_TABLE="fish-finder-results"   # default, only set if you changed it

# Run in development mode
python app.py

# For production, use gunicorn:
pip install gunicorn
gunicorn --bind 0.0.0.0:5000 --workers 2 app:app
```

To run as a systemd service (recommended for production):

```bash
sudo tee /etc/systemd/system/fish-finder-webapp.service > /dev/null << 'EOF'
[Unit]
Description=Fish Finder Flask API
After=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/webapp
Environment=FF_S3_BUCKET=<uploads_bucket_name>
Environment=FF_AWS_REGION=eu-north-1
ExecStart=/home/ubuntu/webapp/venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 2 app:app
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable fish-finder-webapp
sudo systemctl start fish-finder-webapp
```

---

## Step 5: Deploy the Lambda Worker (Future)

The Lambda worker is already declared in Terraform (`infrastracture/lambda.tf`) but its SQS trigger is disabled (`enabled = false`). Activating it requires a two-step process because the ECR repository must exist before the Docker image can be pushed.

### 5a. Build and push the container image

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region eu-north-1 \
    | docker login --username AWS --password-stdin <ecr_repository_url>

# Build the image (from the lambda/ directory)
cd fish-finder-worker/lambda/
docker build -t fish-finder-ml-worker .

# Tag and push
docker tag fish-finder-ml-worker:latest <ecr_repository_url>:latest
docker push <ecr_repository_url>:latest
```

### 5b. Enable the SQS trigger

In `infrastracture/lambda.tf`, change:

```hcl
enabled = false
```

to:

```hcl
enabled = true
```

Then apply:

```bash
cd infrastracture/
terraform apply
```

### 5c. Decommission the EC2 worker

```bash
ssh -i <your-key>.pem ubuntu@<WORKER_PUBLIC_IP>
sudo systemctl disable fish-finder-worker
sudo systemctl stop fish-finder-worker
```

You can then terminate the EC2 worker instance via the AWS Console or by removing `infrastracture/worker_ec2.tf` and running `terraform apply`.

---

## How to Update the ML Model

1. Retrain the model (see `docs/model-training.md`). The output file is `israel_med_fish_v1.pth`.
2. Place the new `.pth` file in `fish-finder-worker/models/`.
3. Run `bash package_worker.sh` to create a new `fish_worker.tar.gz`.
4. SCP the archive to the worker EC2 instance and re-run `setup_env.sh`:
   ```bash
   scp -i <your-key>.pem fish_worker.tar.gz ubuntu@<WORKER_PUBLIC_IP>:~/
   ssh -i <your-key>.pem ubuntu@<WORKER_PUBLIC_IP>
   bash setup_env.sh <SQS_QUEUE_URL> <SNS_TOPIC_ARN>
   ```
   The script is idempotent and will extract the new model, then restart the systemd service.
5. For Lambda: rebuild the Docker image with the new model weights and push to ECR.

---

## Rollback Instructions

### Roll back Terraform changes

Terraform remote state is versioned. To restore a previous state:

```bash
# List available state versions
aws s3api list-object-versions \
    --bucket fish-tf-state \
    --prefix dev/terraform.tfstate

# Download a specific version
aws s3api get-object \
    --bucket fish-tf-state \
    --key dev/terraform.tfstate \
    --version-id <VERSION_ID> \
    terraform.tfstate.backup

# Restore it
cp terraform.tfstate.backup infrastracture/terraform.tfstate
# Then run: terraform apply (will reconcile live resources with the restored state)
```

### Roll back the ML worker

The previous `fish_worker.tar.gz` is not automatically retained. Maintain your own versioned `.pth` files (see `docs/model-training.md` for the naming convention) and re-package from the desired version.

### Roll back the webapp

Re-deploy from the desired git commit. The API is stateless; there is no webapp-side state to migrate.

---

## Environment Variables Reference

### Flask Webapp (`webapp/config.py`)

| Variable | Default | Description |
|---|---|---|
| `FF_AWS_REGION` | `eu-north-1` | AWS region (must match Terraform) |
| `FF_S3_BUCKET` | *(hardcoded)* | S3 uploads bucket name — **must** be set from Terraform output |
| `FF_DYNAMODB_TABLE` | `fish-finder-results` | DynamoDB table name |

`PRESIGNED_URL_EXPIRY_SECONDS` (300 s) and `RESULT_POLL_TIMEOUT_SECONDS` (120 s) are constants in `config.py` and are not overridable via environment variables.

### EC2 Worker (`fish-finder-worker/scripts/ec2_worker.py`)

These are set by `setup_env.sh` and stored in `~/fish-finder-worker/.env`:

| Variable | Source | Description |
|---|---|---|
| `QUEUE_URL` | Terraform output `sqs_queue_url` | SQS queue URL for the fish pipeline |
| `SNS_ARN` | Terraform output `sns_topic_arn` | SNS topic ARN for result notifications |
| `AWS_REGION` | Argument 3 to `setup_env.sh` | Default: `eu-north-1` |

`TABLE_NAME` is hard-coded to `fish-finder-results` in `ec2_worker.py` — change it there if needed.

### Lambda Worker (`infrastracture/lambda.tf`)

| Variable | Source | Description |
|---|---|---|
| `TABLE_NAME` | Terraform — DynamoDB table name | Auto-populated from Terraform |
| `SNS_TOPIC_ARN` | Terraform — SNS topic ARN | Auto-populated from Terraform |
| `AWS_REGION_NAME` | Terraform variable `var.aws_region` | Auto-populated from Terraform |
