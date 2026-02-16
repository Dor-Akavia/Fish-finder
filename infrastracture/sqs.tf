# 1. Create the Dead Letter Queue (DLQ)
resource "aws_sqs_queue" "fish_queue_deadletter" {
  name                      = "fish-processing-queue-dlq"
  message_retention_seconds = 1209600 # 14 days - keep failed items longer for debugging
}

# 2. Update your existing main queue
resource "aws_sqs_queue" "fish_queue" {
  name                       = "fish-processing-queue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 330

  # This is the connection to the DLQ
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.fish_queue_deadletter.arn
    maxReceiveCount     = 3 # Move to DLQ after 3 failed processing attempts
  })
}

# Keep your existing policy exactly as it is (S3 still sends to the main queue)
resource "aws_sqs_queue_policy" "s3_to_sqs_policy" {
  queue_url = aws_sqs_queue.fish_queue.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.fish_queue.arn
      Condition = {
        ArnLike = { "aws:SourceArn" = aws_s3_bucket.fish_uploads.arn }
      }
    }]
  })
}