variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "eu-north-1"
}

variable "ec2_ami_id" {
  description = "The AMI ID for the Ubuntu 24.04 LTS instance"
  type        = string
  default     = "ami-0a664360bb4a53714" # Example for eu-north-1
}

variable "ec2_instance_type" {
  description = "The size of the instance"
  type        = string
  default     = "t3.micro"
}

variable "ec2_key_name" {
  description = "The name of your SSH key pair"
  type        = string
  default     = "Dor-key"
}