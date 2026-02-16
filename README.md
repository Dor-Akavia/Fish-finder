# Fish Finder

[![CI](https://github.com/<YOUR_GITHUB_USERNAME>/fish-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/<YOUR_GITHUB_USERNAME>/fish-finder/actions/workflows/ci.yml)

AI-powered fish species identification for Israeli Mediterranean fishermen — photograph a fish, get its Hebrew name, fishing regulations, and population status in seconds.

**Tech stack:** Python (Flask, PyTorch) | Vanilla JS | AWS (S3, SQS, DynamoDB, Cognito, CloudFront, EC2, Lambda) | Terraform (IaC) | GitHub Actions (CI/CD)

---

## Features

- **AI Fish Identification** — Upload a photo and a MobileNetV2 classifier identifies the species from 20 Mediterranean fish
- **Hebrew Fishing Regulations** — Minimum catch size, seasonal bans, population status, and safety notes in Hebrew
- **Secure Authentication** — Cognito-based sign-up/sign-in with JWT verification on every API call
- **Serverless-Ready Architecture** — Event-driven pipeline (S3 → SQS → Worker → DynamoDB) with a Lambda container path for zero-idle-cost scaling
- **Infrastructure as Code** — Every AWS resource declared in Terraform (18 config files, single `terraform apply`)
- **Direct-to-S3 Uploads** — Presigned POST URLs keep image bytes off the API server, reducing attack surface and load

---

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                   USER                      │
                        │              (Web Browser)                  │
                        └──────────────┬──────────────────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────┐
                        │      CloudFront CDN      │  HTTPS, caching
                        └──────────┬──────┬────────┘
                                   │      │
                    ┌──────────────┘      └──────────────────┐
                    ▼                                         ▼
        ┌───────────────────┐                   ┌────────────────────────┐
        │   S3 (frontend)   │                   │   Flask API (EC2)      │
        │   Static files    │                   │   /api/upload-url      │
        └───────────────────┘                   │   /api/results/<id>    │
                                                └──────────┬─────────────┘
                                                           │
                                          ┌────────────────┘
                                          │  1. Returns presigned S3 POST URL
                                          ▼
                                ┌──────────────────┐
                                │   S3 (uploads)   │  ← Browser POSTs image directly
                                └────────┬─────────┘
                                         │
                                         │  S3 Event Notification
                                         ▼
                                ┌──────────────────┐
                                │       SQS        │  fish-finder-queue
                                └────────┬─────────┘
                                         │  Long-poll / Event trigger
                              ┌──────────┴──────────┐
                              ▼                      ▼
                   ┌──────────────────┐   ┌──────────────────────┐
                   │  EC2 ML Worker   │   │  Lambda (container)  │
                   │  (current)       │   │  (future, scales     │
                   │                  │   │   to zero)           │
                   └────────┬─────────┘   └──────────┬───────────┘
                            │                        │
                            └──────────┬─────────────┘
                                       │  PyTorch MobileNetV2 inference
                                       │  20 Mediterranean fish species
                                       ▼
                              ┌──────────────────┐
                              │    DynamoDB      │  fish-finder-results
                              └────────┬─────────┘
                                       │
                              ┌────────┴─────────┐
                              ▼                  ▼
                        ┌──────────┐      ┌──────────────┐
                        │   SNS    │      │  Frontend    │
                        │ (alerts) │      │  polls GET   │
                        └──────────┘      │  /api/results│
                                          └──────────────┘
```

**Auth:** All API calls carry a JWT issued by AWS Cognito. The Flask API verifies the token signature against the Cognito JWKS endpoint on every request.

---

## Quick Start

### 1. Provision infrastructure

```bash
# Create the Terraform state backend first (see docs/deployment.md)

cd infrastracture/
terraform init
terraform apply
```

After apply, note the output values — you will need them in the next steps.

### 2. Deploy the ML worker to EC2

```bash
bash package_worker.sh

scp -i <your-key>.pem \
    fish_worker.tar.gz \
    fish-finder-worker/scripts/setup_env.sh \
    ubuntu@<WORKER_PUBLIC_IP>:~/

ssh -i <your-key>.pem ubuntu@<WORKER_PUBLIC_IP>
bash setup_env.sh <SQS_QUEUE_URL> <SNS_TOPIC_ARN>
```

### 3. Deploy the Flask webapp

```bash
ssh -i <your-key>.pem ubuntu@<WEBAPP_PUBLIC_IP>

cd webapp/
pip install -r requirements.txt
export FF_S3_BUCKET="<uploads_bucket_name>"
export FF_AWS_REGION="eu-north-1"
python app.py
```

### 4. Open the app

Visit the CloudFront URL from Terraform outputs: `https://<cloudfront_url>`

---

## Directory Structure

```
fish-finder/
├── infrastracture/          Terraform — all AWS resources (eu-north-1)
│   ├── vpc.tf               VPC, subnets, routing
│   ├── security_groups.tf   Security group rules
│   ├── s3.tf                S3 bucket: user uploads
│   ├── cdn_bucket.tf        S3 bucket: frontend static files
│   ├── cloudfront.tf        CloudFront CDN distribution
│   ├── cognito.tf           Cognito User Pool + app clients
│   ├── sqs.tf               SQS queue (pipeline messaging)
│   ├── sns.tf               SNS topic (result notifications)
│   ├── dynamodb.tf          Results table
│   ├── lambda.tf            Lambda container worker + ECR (future)
│   ├── webapp_ec2.tf        EC2 Flask API instance
│   ├── worker_ec2.tf        EC2 ML worker instance
│   ├── iam.tf               IAM roles and policies
│   ├── budgets.tf           Cost alert thresholds
│   ├── outputs.tf           Terraform output values
│   └── backend.tf           Remote state: S3 + DynamoDB locking
│
├── fish-finder-worker/      ML worker (EC2 and Lambda)
│   ├── scripts/
│   │   ├── ec2_worker.py         SQS long-poll loop + inference orchestration
│   │   ├── model_logic.py        FishClassifier (MobileNetV2 wrapper)
│   │   ├── fish_dictionary.py    20-species registry (Hebrew names + regulations)
│   │   ├── data_set_injector.py  iNaturalist image downloader
│   │   ├── train_module.py       PyTorch training script (Colab-ready)
│   │   └── setup_env.sh          EC2 bootstrap (swap, venv, systemd)
│   ├── lambda/                   Dockerfile + lambda_handler.py (future)
│   ├── models/                   Trained weights (.pth) — not in git, see below
│   ├── dataset/                  Training images — not in git, see below
│   └── tests/
│
├── webapp/                  Flask REST API + vanilla frontend
│   ├── app.py               API: /api/upload-url, /api/results/<id>
│   ├── config.py            AWS config (env-var overridable)
│   └── static/              index.html, style.css, app.js
│
├── mobile/                  React Native + Expo (planned — not yet active)
│   ├── src/                 Screens, components, services
│   └── app.json             Expo config
│
├── docs/                    Detailed documentation
│   ├── architecture.md      System architecture and design decisions
│   ├── deployment.md        Step-by-step deployment guide
│   ├── api.md               REST API reference
│   ├── model-training.md    Dataset preparation and training
│   ├── mobile-setup.md      Mobile app setup (for future development)
│   └── mobile-release-guide.md  Mobile release process (for future development)
│
├── package_worker.sh        Bundles worker scripts + model into fish_worker.tar.gz
└── package_webapp.sh        Bundles webapp for deployment
```

### Files not tracked in git

| File / Directory | Reason | How to obtain |
|---|---|---|
| `fish-finder-worker/models/*.pth` | Model weights (~14 MB) | Train with `train_module.py` (see [docs/model-training.md](docs/model-training.md)) |
| `fish-finder-worker/dataset/` | Training images (~966 files) | Run `data_set_injector.py` to download from iNaturalist |
| `*.tfstate` | Contains AWS resource IDs and secrets | Generated by `terraform init` (stored remotely in S3) |
| `*.pem` | SSH private keys | Create via AWS Console or CLI |

---

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System architecture, component rationale, data flow diagrams |
| [docs/deployment.md](docs/deployment.md) | Full deployment guide, environment variables, rollback |
| [docs/api.md](docs/api.md) | REST API reference for the Flask webapp |
| [docs/model-training.md](docs/model-training.md) | Dataset collection, training, model versioning |

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **SQS between S3 and worker** | Decouples uploads from inference; absorbs traffic spikes; at-least-once delivery |
| **EC2 t3.micro + swap for ML** | PyTorch needs ~1.5 GB RAM; swap file supplements the 1 GB instance; low cost for dev-scale traffic |
| **Lambda container as future worker** | Scales to zero when idle; removes always-on EC2 cost; 1536 MB memory fits PyTorch + model |
| **MobileNetV2** | Lightweight architecture designed for CPU inference on constrained hardware |
| **Presigned S3 POST URLs** | Image bytes never touch the API server — reduces load and attack surface |
| **Single CloudFront distribution** | Routes static assets to S3, API calls to EC2; single HTTPS hostname |
| **Cognito User Pool** | Full auth lifecycle without a custom auth service; separate app clients per platform |

---

## CI/CD

The project uses GitHub Actions for continuous integration and deployment.

**CI** (every push and PR): Lints Python with ruff, runs 26 pytest tests, validates Terraform configuration.

**CD** (merge to main): Deploys the webapp to EC2 via SSH, builds the Lambda Docker image and pushes to ECR.

### Setting up GitHub Secrets

After creating your GitHub repo, go to **Settings > Secrets and variables > Actions** and add these secrets:

| Secret | Value | Where to find it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key | AWS Console > IAM > Users > Security credentials |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | Same as above (shown once at creation) |
| `AWS_REGION` | `eu-north-1` | Your Terraform region |
| `EC2_SSH_PRIVATE_KEY` | Contents of your `.pem` file | `cat <your-key>.pem` and paste the full output |
| `WEBAPP_EC2_HOST` | Webapp EC2 public IP | `terraform output webapp_public_ip` |
| `FF_S3_BUCKET` | S3 uploads bucket name | `terraform output uploads_bucket_name` |
| `FF_COGNITO_POOL_ID` | Cognito User Pool ID | `terraform output cognito_user_pool_id` |
| `FF_COGNITO_CLIENT_ID` | Cognito webapp client ID | `terraform output cognito_webapp_client_id` |
| `ECR_REPOSITORY_URL` | ECR repository URL | `terraform output ecr_repository_url` |

### Running tests locally

```bash
pip install -r requirements-dev.txt -r webapp/requirements.txt
ruff check webapp/ fish-finder-worker/scripts/
pytest -v
```
