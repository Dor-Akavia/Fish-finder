# =============================================================================
# outputs.tf - Terraform Outputs
#
# Copy these values into:
#   - setup_webapp.sh     (webapp deployment: COGNITO_POOL_ID, COGNITO_CLIENT_ID, S3_BUCKET)
#   - webapp/config.py    (FF_S3_BUCKET)
#   - mobile Amplify config (cognito_user_pool_id, cognito_mobile_client_id)
#   - build_and_push.sh   (ECR_REPO_URL)
# =============================================================================

# --- EC2: Webapp ---
output "webapp_public_ip" {
  description = "Public IP of the Flask webapp EC2 instance"
  value       = aws_instance.webapp.public_ip
}

output "webapp_ssh_command" {
  description = "SSH command for the webapp"
  value       = "ssh -i Dor-key.pem ubuntu@${aws_instance.webapp.public_ip}"
}

# --- SQS ---
output "sqs_queue_url" {
  description = "SQS queue URL (triggers Lambda automatically via event source mapping)"
  value       = aws_sqs_queue.fish_queue.id
}

# --- S3 ---
output "uploads_bucket_name" {
  description = "S3 uploads bucket name → webapp/config.py FF_S3_BUCKET"
  value       = aws_s3_bucket.fish_uploads.id
}

output "frontend_bucket_name" {
  description = "S3 frontend bucket name (deploy static files here)"
  value       = aws_s3_bucket.frontend.id
}

# --- DynamoDB ---
output "dynamodb_table_name" {
  description = "DynamoDB results table name"
  value       = aws_dynamodb_table.fish_results.name
}

# --- Cognito ---
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID → webapp/config.py + mobile Amplify config"
  value       = aws_cognito_user_pool.fish_finder.id
}

output "cognito_webapp_client_id" {
  description = "Cognito app client ID for the webapp"
  value       = aws_cognito_user_pool_client.webapp_client.id
}

output "cognito_mobile_client_id" {
  description = "Cognito app client ID for the mobile app"
  value       = aws_cognito_user_pool_client.mobile_client.id
}

# --- CloudFront ---
output "cloudfront_url" {
  description = "CloudFront distribution URL (your app's public URL)"
  value       = "https://${aws_cloudfront_distribution.fish_finder.domain_name}"
}

# --- Lambda / ECR ---
output "ecr_repository_url" {
  description = "ECR repo URL → used in build_and_push.sh"
  value       = aws_ecr_repository.ml_worker.repository_url
}

output "aws_region" {
  description = "AWS region all resources are deployed in"
  value       = var.aws_region
}
