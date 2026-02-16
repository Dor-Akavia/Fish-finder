# =============================================================================
# Dockerfile - Fish Finder Lambda ML Worker
#
# Uses the AWS-provided Python Lambda base image which includes the Lambda
# runtime. We install CPU-only PyTorch (avoids the GPU CUDA libraries,
# keeping the image ~2GB instead of ~8GB).
#
# Build & push to ECR (run from fish-finder-worker/lambda/):
#   aws ecr get-login-password --region eu-north-1 | \
#       docker login --username AWS --password-stdin <ECR_URL>
#   docker build -t fish-finder-ml-worker .
#   docker tag fish-finder-ml-worker:latest <ECR_URL>:latest
#   docker push <ECR_URL>:latest
#
# Or use: bash build_and_push.sh <ECR_REPO_URL>
# =============================================================================

# Use the official AWS Lambda Python 3.11 base image
FROM public.ecr.aws/lambda/python:3.11

# Install PyTorch CPU-only
RUN pip install --no-cache-dir \
    "torch==2.2.1+cpu" \
    "torchvision==0.17.1+cpu" \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    "numpy<2.0.0" \
    boto3 Pillow

# NEW: Pre-download the base weights into the image during build time
# This prevents the 'Read-only file system' error when torchvision tries to download them at runtime.
RUN python3 -c "from torchvision import models; models.mobilenet_v2(weights='IMAGENET1K_V1')"

# Copy worker source files into the Lambda task root
COPY lambda/lambda_handler.py ${LAMBDA_TASK_ROOT}/
COPY scripts/model_logic.py ${LAMBDA_TASK_ROOT}/
COPY scripts/fish_dictionary.py ${LAMBDA_TASK_ROOT}/

# Create models directory and copy weights
RUN mkdir -p ${LAMBDA_TASK_ROOT}/models
COPY models/israel_med_fish_v1.pth ${LAMBDA_TASK_ROOT}/models/

CMD [ "lambda_handler.handler" ]