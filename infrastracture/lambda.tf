# =============================================================================
# lambda.tf - Serverless ML Worker (Lambda Container Image)
#
# A containerised Lambda function that replaces the EC2 long-polling worker.
# Triggered directly by SQS - no polling loop needed.
#
# Flow: S3 upload → SQS → Lambda invocation → DynamoDB + SNS
#
# IMPORTANT - two-step deploy required:
#   Step 1: terraform apply  (creates the ECR repo)
#   Step 2: bash fish-finder-worker/lambda/build_and_push.sh  (build + push image)
#   Step 3: terraform apply  (creates Lambda using the image + enables SQS trigger)
# =============================================================================

# ECR repository - stores the Docker image with PyTorch + model + handler
resource "aws_ecr_repository" "ml_worker" {
  name         = "fish-finder-ml-worker"
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true # Scan for CVEs on every push
  }

  tags = { Project = "fish-finder" }
}

# Keep only the 3 most recent images to control ECR storage costs
resource "aws_ecr_lifecycle_policy" "ml_worker" {
  repository = aws_ecr_repository.ml_worker.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 3 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 3
      }
      action = { type = "expire" }
    }]
  })
}

# Lambda function - container image because PyTorch exceeds the 250MB zip limit
resource "aws_lambda_function" "ml_worker" {
  function_name = "fish-finder-ml-worker"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.ml_worker.repository_url}:latest"
  role          = aws_iam_role.lambda_worker_role.arn
  timeout       = 60   # 1 min - inference takes ~3-5s, 60s gives plenty of margin
  memory_size   = 1536 # MB - PyTorch CPU needs ~1.5GB to load model + run inference

  # Cap concurrent invocations to prevent billing spikes.
  # Excess SQS messages wait in the queue until a slot opens.
  # At 1536MB * 60s * 5 concurrent = worst case ~$0.007/batch — very safe.
  # reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME      = aws_dynamodb_table.fish_results.name
      SNS_TOPIC_ARN   = aws_sns_topic.fish_alerts.arn
      AWS_REGION_NAME = var.aws_region
    }
  }

  depends_on = [aws_ecr_repository.ml_worker]
  tags       = { Project = "fish-finder" }
}

# SQS → Lambda trigger (EC2 worker decommissioned, Lambda is now the primary processor)
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = aws_sqs_queue.fish_queue.arn
  function_name    = aws_lambda_function.ml_worker.arn
  batch_size       = 1 # One image per Lambda invocation
  enabled          = true
}
