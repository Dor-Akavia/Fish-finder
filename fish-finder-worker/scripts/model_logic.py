import os
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
from pathlib import Path
from fish_dictionary import FISH_DATA

# Redirect Torch home to /tmp in case any utility tries to write to a home dir
os.environ['TORCH_HOME'] = '/tmp/.torch'

class FishClassifier:
    def __init__(self):
        # 1. Setup Paths
        current_dir = Path(__file__).resolve().parent
        self._is_lambda = os.environ.get("AWS_LAMBDA_FUNCTION_NAME") is not None

        # Point directly to the models folder bundled in /var/task/
        if self._is_lambda:
            self.model_dir = current_dir / "models"
        else:
            self.model_dir = current_dir.parent / "models"

        self.model_path = self.model_dir / "israel_med_fish_v1.pth"

        # REMOVED: self.model_dir.mkdir(exist_ok=True)
        # This causes Errno 30 on Lambda because /var/task is read-only.

        # 2. Define Architecture (MobileNetV2)
        print("--- Initializing MobileNetV2 Architecture ---")
        # weights=None prevents the model from trying to download anything during init
        self.model = models.mobilenet_v2(weights=None)

        # 3. Modify the 'Head' (Output Layer) for our 20 species
        num_ftrs = self.model.classifier[1].in_features
        self.model.classifier[1] = nn.Linear(num_ftrs, len(FISH_DATA))

        # 4. Load Custom Weights if they exist
        if self.model_path.exists():
            print(f"--- Loading custom trained weights from: {self.model_path} ---")
            state_dict = torch.load(self.model_path, map_location='cpu')
            self.model.load_state_dict(state_dict)
        else:
            print(f"--- WARNING: No trained model found at {self.model_path} ---")
            # REMOVED: torch.save(self.model.state_dict(), self.model_path)
            # Never attempt to save weights to the read-only /var/task/models directory.

        self.model.eval()

        self.transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])

        self.species_list = sorted(FISH_DATA.keys())

    def predict(self, image_path):
        """
        Run inference on a fish image.

        Returns:
            species_key (str): Latin species name (e.g. "Sparus aurata")
            fish_info   (dict): Full entry from FISH_DATA
            confidence  (float): Softmax probability of the top prediction (0.0 - 1.0)
                                 Values below ~0.70 are worth flagging for manual review.
        """
        try:
            img = Image.open(image_path).convert('RGB')
            img_t = self.transform(img).unsqueeze(0)  # Add batch dimension

            with torch.no_grad():
                outputs = self.model(img_t)

                # Convert raw logits to probabilities so we get a meaningful confidence score
                probabilities = torch.nn.functional.softmax(outputs, dim=1)
                confidence, predicted_idx = torch.max(probabilities, 1)

            idx         = predicted_idx.item()
            species_key = self.species_list[idx]
            fish_info   = FISH_DATA[species_key]
            conf_value  = confidence.item()

            print(f"--- Prediction: {species_key} | Confidence: {conf_value:.1%} ---")
            return species_key, fish_info, conf_value

        except Exception as e:
            print(f"--- Prediction ERROR: {e} ---")
            return "Error", {
                "name": "שגיאה בזיהוי",
                "native_status": "Unknown",
                "population_status": "Unknown",
                "avg_size_cm": 0,
                "regulations": {"min_size_cm": 0, "seasonal_ban": False, "notes": str(e)},
                "description": str(e),
            }, 0.0

# For quick local testing
if __name__ == "__main__":
    clf = FishClassifier()
    print(f"Model ready for {len(FISH_DATA)} species.")
