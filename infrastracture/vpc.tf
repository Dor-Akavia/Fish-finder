resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/18"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "fish-finder-vpc"
  }
}

# Internet Gateway to allow internet access (needed for worker to reach AWS APIs)
resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
}

# Subnet in AZ 1
resource "aws_subnet" "public_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "eu-north-1a"
  map_public_ip_on_launch = true # Worker gets a public IP

  tags = { Name = "fish-finder-public-1" }
}

# Subnet in AZ 2
resource "aws_subnet" "public_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "eu-north-1b"
  map_public_ip_on_launch = true

  tags = { Name = "fish-finder-public-2" }
}

# Route Table to route traffic to the Internet Gateway
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
}

# Associate Route Table with Subnets
resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public_rt.id
}