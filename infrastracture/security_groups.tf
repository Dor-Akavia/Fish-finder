# --- ML Worker Security Group (DECOMMISSIONED) ---
# Removed with the EC2 worker. See worker_ec2.tf for history.

# --- Webapp Security Group ---
# Accepts HTTP from CloudFront on port 5000 and SSH for deployment.
resource "aws_security_group" "webapp_sg" {
  name        = "fish-finder-webapp-sg"
  description = "Security group for Flask webapp EC2"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Flask API (proxied by CloudFront)"
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # CloudFront IPs are dynamic; restrict with prefix list in production
  }

  ingress {
    description = "SSH for deployment"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # TODO: Restrict to your IP in production
  }

  egress {
    description = "All outbound to reach AWS APIs"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}