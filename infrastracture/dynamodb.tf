resource "aws_dynamodb_table" "fish_results" {
  name         = "fish-finder-results"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ImageId"

  attribute {
    name = "ImageId"
    type = "S"
  }
}