# hosts the static web app, served via CloudFront
# =============================================================================
# --- Frontend (Static Website) Bucket ---

resource "aws_s3_bucket" "frontend" {
  bucket_prefix = "fish-finder-frontend-"
  force_destroy = true

  tags = { Name = "fish-finder-frontend" }
}

# Block direct public access - CloudFront accesses this via OAC (see cloudfront.tf)
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Static website settings so S3 serves index.html for the root path
resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document { suffix = "index.html" }
  # SPA: route all 404s back to index.html so client-side routing works
  error_document { key = "index.html" }
}

# Allow CloudFront OAC to read frontend objects (requires cloudfront.tf to exist first)
resource "aws_s3_bucket_policy" "frontend_oac_policy" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.fish_finder.arn
        }
      }
    }]
  })
  depends_on = [aws_cloudfront_distribution.fish_finder]
}