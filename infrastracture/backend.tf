terraform {
  backend "s3" {
    bucket         = "fish-tf-state"
    key            = "dev/terraform.tfstate"
    region         = "eu-north-1"
    dynamodb_table = "fish-tf-locks"
    encrypt        = true
  }
}
