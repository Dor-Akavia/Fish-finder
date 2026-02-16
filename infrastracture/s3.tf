
# --- Upload Bucket ---

resource "aws_s3_bucket" "fish_uploads" {
  bucket_prefix = "fish-finder-uploads-"
  force_destroy = true # Safe to delete even when it contains images (PoC)
}

# CORS policy - required for direct browser-to-S3 uploads via presigned POST URL.
# Without this the browser blocks the upload request with a CORS error.
resource "aws_s3_bucket_cors_configuration" "fish_uploads_cors" {
  bucket = aws_s3_bucket.fish_uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST", "PUT", "GET"]
    # TODO: Restrict to your domain in production (e.g. ["https://app.fishfinder.io"])
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Notify SQS when a new image is uploaded - kicks off the entire ML pipeline
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.fish_uploads.id

  queue {
    queue_arn = aws_sqs_queue.fish_queue.arn
    events    = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_sqs_queue_policy.s3_to_sqs_policy]
}
