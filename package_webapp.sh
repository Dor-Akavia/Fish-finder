#!/bin/bash
# =============================================================================
# package_webapp.sh - Bundle the Fish Finder webapp for deployment to EC2
# =============================================================================
#
# Run this from the project root (fish-finder/).
#
# Output: fish_webapp.tar.gz
#
# Then deploy with:
#   scp -i Dor-key.pem fish_webapp.tar.gz ubuntu@<WEBAPP_EC2_IP>:~/
#   ssh -i Dor-key.pem ubuntu@<WEBAPP_EC2_IP>
#   tar -xzf fish_webapp.tar.gz
#   bash webapp/setup_webapp.sh <COGNITO_POOL_ID> <COGNITO_CLIENT_ID> <S3_BUCKET>
#
# Find the values in your Terraform outputs after 'terraform apply':
#   terraform output cognito_user_pool_id
#   terraform output cognito_webapp_client_id
#   terraform output uploads_bucket_name
# =============================================================================

set -e

WEBAPP_DIR="webapp"
OUTPUT="fish_webapp.tar.gz"

echo ""
echo "=========================================="
echo "  Fish Finder - Webapp Packager"
echo "=========================================="

# Validate all required source files exist before we start
echo "Checking required files..."
REQUIRED=(
    "$WEBAPP_DIR/app.py"
    "$WEBAPP_DIR/config.py"
    "$WEBAPP_DIR/requirements.txt"
    "$WEBAPP_DIR/setup_webapp.sh"
    "$WEBAPP_DIR/static/index.html"
    "$WEBAPP_DIR/static/app.js"
    "$WEBAPP_DIR/static/style.css"
)
for file in "${REQUIRED[@]}"; do
    if [ ! -f "$file" ]; then
        echo "  Missing: $file"
        exit 1
    fi
    echo "  Found:   $file"
done

# Create the archive directly from the webapp directory
# The archive preserves the webapp/ directory structure so it extracts
# cleanly to ~/webapp/ on the EC2 instance.
echo ""
echo "Creating archive: $OUTPUT..."
tar -czf "$OUTPUT" \
    "$WEBAPP_DIR/app.py" \
    "$WEBAPP_DIR/config.py" \
    "$WEBAPP_DIR/requirements.txt" \
    "$WEBAPP_DIR/setup_webapp.sh" \
    "$WEBAPP_DIR/static/"

ARCHIVE_SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "Package created: $OUTPUT ($ARCHIVE_SIZE)"

echo ""
echo "=========================================="
echo "  Next steps:"
echo ""
echo "  1. SCP the archive to your webapp EC2:"
echo "     scp -i Dor-key.pem $OUTPUT ubuntu@<WEBAPP_EC2_IP>:~/"
echo ""
echo "  2. SSH into the instance:"
echo "     ssh -i Dor-key.pem ubuntu@<WEBAPP_EC2_IP>"
echo ""
echo "  3. Extract the archive:"
echo "     tar -xzf $OUTPUT"
echo ""
echo "  4. Run setup (paste your Terraform output values):"
echo "     bash webapp/setup_webapp.sh <COGNITO_POOL_ID> <COGNITO_CLIENT_ID> <S3_BUCKET>"
echo "=========================================="
