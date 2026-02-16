# =============================================================================
# webapp_ec2.tf - Flask API Server (EC2)
#
# Hosts webapp/app.py - presigned S3 URL generation and DynamoDB result polling.
#
# Deploy after 'terraform apply':
#   scp -i Dor-key.pem -r webapp/ ubuntu@<webapp_public_ip>:~/
#   ssh -i Dor-key.pem ubuntu@<webapp_public_ip>
#   bash ~/webapp/setup_webapp.sh <COGNITO_POOL_ID> <S3_BUCKET> <AWS_REGION>
#
# NOTE: For a production serverless alternative see lambda.tf.
# =============================================================================

resource "aws_instance" "webapp" {
  ami                    = var.ec2_ami_id
  instance_type          = var.ec2_instance_type
  subnet_id              = aws_subnet.public_1.id
  key_name               = var.ec2_key_name
  vpc_security_group_ids = [aws_security_group.webapp_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.webapp_profile.name

  tags = { Name = "fish-finder-webapp" }

  user_data = <<-EOF
    #!/bin/bash
    apt-get update -q
    apt-get install -y -q python3-pip python3-venv nginx
    echo "Webapp EC2 ready - run setup_webapp.sh to complete setup" > /home/ubuntu/status.txt
  EOF
}
