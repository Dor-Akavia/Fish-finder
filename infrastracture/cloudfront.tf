# =============================================================================
# cloudfront.tf - CDN & HTTPS
#
# One CloudFront distribution with two origins:
#   1. S3 frontend bucket  → serves static HTML/CSS/JS at /
#   2. Webapp EC2          → proxies API calls at /api/*
#
# Uses Origin Access Control (OAC) for S3 (modern replacement for OAI).
# The S3 bucket is private; only CloudFront can read from it.
# =============================================================================

resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  name                              = "fish-finder-frontend-oac"
  description                       = "OAC for Fish Finder frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "fish_finder" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "Fish Finder - frontend + API proxy"
  price_class         = "PriceClass_100" # EU + North America only (cheapest)

  # Origin 1: S3 static frontend
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac.id
  }

  # Origin 2: Flask webapp EC2 API
  origin {
    domain_name = aws_instance.webapp.public_dns
    origin_id   = "EC2-webapp-api"

    custom_origin_config {
      http_port              = 5000
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default: serve static files from S3
  default_cache_behavior {
    target_origin_id       = "S3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # /api/* proxy to Flask - never cache, forward Authorization header
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "EC2-webapp-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = true
      headers      = ["Authorization"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # SPA routing: return index.html for missing paths
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    # TODO: Add custom domain + ACM cert here for production
  }

  tags = { Project = "fish-finder" }
}
