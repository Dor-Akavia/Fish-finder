#!/bin/bash
# =============================================================================
# package_worker.sh - Bundle the Fish Finder worker for deployment to EC2
# =============================================================================
#
# Run this from the project root (fish-finder/).
#
# Output: fish_worker.tar.gz
#
# Then deploy with:
#   scp -i Dor-key.pem fish_worker.tar.gz fish-finder-worker/scripts/setup_env.sh ubuntu@<EC2_IP>:~/
#   ssh -i Dor-key.pem ubuntu@<EC2_IP>
#   bash setup_env.sh <SQS_URL> <SNS_ARN>
#
# Find SQS_URL and SNS_ARN in your Terraform outputs after 'terraform apply'.
# =============================================================================

set -e

WORKER_DIR="fish-finder-worker"
STAGING="./worker_staging"        # Temp dir to build the archive structure
OUTPUT="fish_worker.tar.gz"

echo ""
echo "=========================================="
echo "  Fish Finder - Worker Packager"
echo "=========================================="

# Validate all required source files exist before we start
echo "Checking required files..."
REQUIRED=(
    "$WORKER_DIR/scripts/ec2_worker.py"
    "$WORKER_DIR/scripts/model_logic.py"
    "$WORKER_DIR/scripts/fish_dictionary.py"
    "$WORKER_DIR/models/israel_med_fish_v1.pth"
    "$WORKER_DIR/scripts/setup_env.sh"
)
for file in "${REQUIRED[@]}"; do
    if [ ! -f "$file" ]; then
        echo "  ❌ Missing: $file"
        exit 1
    fi
    echo "  ✅ Found:   $file"
done

# Clean up any previous staging directory
rm -rf "$STAGING"

# Build the staging structure that mirrors what EC2 expects:
#   ~/fish-finder-worker/
#   ├── scripts/   (ec2_worker.py, model_logic.py, fish_dictionary.py)
#   └── models/    (israel_med_fish_v1.pth)
echo ""
echo "Building staging directory..."
mkdir -p "$STAGING/scripts"
mkdir -p "$STAGING/models"

cp "$WORKER_DIR/scripts/ec2_worker.py"          "$STAGING/scripts/"
cp "$WORKER_DIR/scripts/model_logic.py"         "$STAGING/scripts/"
cp "$WORKER_DIR/scripts/fish_dictionary.py"     "$STAGING/scripts/"
cp "$WORKER_DIR/models/israel_med_fish_v1.pth"  "$STAGING/models/"

echo "  Staged: scripts/ec2_worker.py"
echo "  Staged: scripts/model_logic.py"
echo "  Staged: scripts/fish_dictionary.py"
MODEL_SIZE=$(du -h "$STAGING/models/israel_med_fish_v1.pth" | cut -f1)
echo "  Staged: models/israel_med_fish_v1.pth ($MODEL_SIZE)"

# Create the archive from the staging directory
echo ""
echo "Creating archive: $OUTPUT..."
tar -czf "$OUTPUT" -C "$STAGING" .

# Clean up staging directory
rm -rf "$STAGING"

ARCHIVE_SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "✅ Package created: $OUTPUT ($ARCHIVE_SIZE)"

echo ""
echo "=========================================="
echo "  Next steps:"
echo ""
echo "  1. SCP both files to your EC2 instance:"
echo "     scp -i Dor-key.pem \\"
echo "         $OUTPUT \\"
echo "         $WORKER_DIR/scripts/setup_env.sh \\"
echo "         ubuntu@<YOUR_EC2_IP>:~/"
echo ""
echo "  2. SSH into the instance:"
echo "     ssh -i Dor-key.pem ubuntu@<YOUR_EC2_IP>"
echo ""
echo "  3. Run setup (paste your Terraform output values):"
echo "     bash setup_env.sh <SQS_QUEUE_URL> <SNS_TOPIC_ARN>"
echo "=========================================="
