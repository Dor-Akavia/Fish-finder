# =============================================================================
# worker_ec2.tf - EC2 ML Worker (DECOMMISSIONED)
#
# This EC2 worker has been replaced by the Lambda container worker (lambda.tf).
# The Lambda approach is:
#   - Cheaper: no idle EC2 costs, pay only per invocation
#   - Simpler: SQS triggers Lambda directly, no polling loop or systemd service
#   - Scalable: concurrent invocations handle traffic spikes automatically
#
# This file is kept for reference. All resources below are commented out.
# To re-enable, uncomment the resources and set the Lambda SQS trigger
# (lambda.tf) enabled = false to avoid duplicate processing.
# =============================================================================

# resource "aws_instance" "ml_worker" {
#   ami           = var.ec2_ami_id
#   instance_type = var.ec2_instance_type
#   subnet_id     = aws_subnet.public_1.id
#
#   key_name      = "Dor-key"
#
#   vpc_security_group_ids = [aws_security_group.ml_worker_sg.id]
#   iam_instance_profile   = aws_iam_instance_profile.ml_worker_profile.name
#
#   tags = {
#     Name = "fish-finder-ml-worker"
#   }
#
#   user_data = <<-EOF
#               #!/bin/bash
#               apt-get update
#               apt-get install -y python3-pip
#               pip3 install boto3
#               echo "Worker Ready" > /home/ubuntu/status.txt
#               EOF
# }
