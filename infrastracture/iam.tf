
# =============================================================================
# iam.tf - IAM Roles & Policies
#
# Two principals, each with least-privilege permissions:
#   1. lambda_worker_role - Lambda ML worker (SQS, S3, DynamoDB, SNS, ECR, CloudWatch)
#   2. webapp_role        - Webapp EC2 (S3 presigned URL generation, DynamoDB read)
#
# The EC2 ml_worker_role was removed when the EC2 worker was decommissioned
# in favour of the Lambda worker. See worker_ec2.tf for history.
# =============================================================================

# --- 1. Lambda ML Worker ---

resource "aws_iam_role" "lambda_worker_role" {
  name = "fish-finder-lambda-worker-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_worker_policy" {
  name = "fish-finder-lambda-worker-policy"
  role = aws_iam_role.lambda_worker_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Write logs to CloudWatch (standard Lambda requirement)
      {
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Effect   = "Allow"
        Resource = "arn:aws:logs:*:*:*"
      },
      # Read + delete SQS messages (event source mapping)
      {
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Effect   = "Allow"
        Resource = aws_sqs_queue.fish_queue.arn
      },
      # Download fish images from the uploads bucket
      {
        Action   = ["s3:GetObject"]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.fish_uploads.arn}/*"
      },
      # Write inference results to DynamoDB
      {
        Action   = ["dynamodb:PutItem"]
        Effect   = "Allow"
        Resource = aws_dynamodb_table.fish_results.arn
      },
      # Publish Hebrew identification notification
      {
        Action   = ["sns:Publish"]
        Effect   = "Allow"
        Resource = aws_sns_topic.fish_alerts.arn
      },
      # Pull container image from ECR
      {
        Action   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:GetAuthorizationToken"]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

# --- 3. Webapp EC2 ---
# Needs to generate presigned S3 upload URLs and read DynamoDB results.
# Does NOT need access to SQS, SNS, or the ML model.

resource "aws_iam_role" "webapp_role" {
  name = "fish-finder-webapp-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "webapp_policy" {
  name = "fish-finder-webapp-policy"
  role = aws_iam_role.webapp_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Generate presigned POST URLs (s3:PutObject is required to sign the URL)
      {
        Action   = ["s3:PutObject"]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.fish_uploads.arn}/*"
      },
      # Poll DynamoDB for ML results
      {
        Action   = ["dynamodb:GetItem"]
        Effect   = "Allow"
        Resource = aws_dynamodb_table.fish_results.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "webapp_profile" {
  name = "fish-finder-webapp-profile"
  role = aws_iam_role.webapp_role.name
}