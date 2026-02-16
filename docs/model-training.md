# Model Training

Fish Finder uses a fine-tuned MobileNetV2 classifier (`israel_med_fish_v1.pth`). This document covers dataset requirements, image collection, training, and model versioning.

---

## Model Summary

| Property | Value |
|---|---|
| Base architecture | MobileNetV2 (ImageNet pre-trained) |
| Output classes | 20 Mediterranean fish species |
| Input size | 224 × 224 RGB |
| Training set size | ~966 images (~48 images/class) |
| Training script | `fish-finder-worker/scripts/train_module.py` |
| Target training accuracy | 95% (early stopping) |
| Saved format | PyTorch `state_dict` (`.pth`) |

---

## Dataset Requirements

### Current (v1 — development)

| Requirement | Current value | Recommended minimum |
|---|---|---|
| Number of species | 20 | 20 |
| Images per class | ~48 | 50 |
| Total images | ~966 | 1,000 |

The model was trained on research-grade observations from iNaturalist. Results at this scale are sufficient for demonstration purposes but will produce misclassifications on poorly-lit or out-of-water photographs.

### Production Target

| Requirement | Recommended value |
|---|---|
| Number of species | 50–60 (full Israeli Mediterranean catalog) |
| Images per class | 300–500 |
| Total images | 15,000–30,000 |
| Image variety | Underwater + out-of-water, multiple angles, varied lighting |
| Data augmentation | Horizontal flip, rotation ±15°, colour jitter (brightness, contrast) |

At 300+ images per class and 50+ species, you should expect >90% top-1 accuracy on a held-out test set with proper train/val/test splitting.

---

## Dataset Folder Structure

The training script uses `torchvision.datasets.ImageFolder`, which requires one subdirectory per class. **Class index assignment is determined by the alphabetical order of the folder names.** This ordering must match the order of keys in `fish_dictionary.py` (which `model_logic.py` also sorts alphabetically via `sorted(FISH_DATA.keys())`).

```
dataset/
├── Balistes carolinensis/
│   ├── 1.jpg
│   ├── 2.jpg
│   └── ...
├── Dicentrarchus labrax/
│   └── ...
├── Diplodus sargus/
│   └── ...
├── Epinephelus marginatus/
│   └── ...
...
└── Trachinus draco/
    └── ...
```

**Critical:** If you add or rename species folders, you must also update `fish_dictionary.py` to keep the species list consistent. A mismatch will cause the model to return wrong species names without any error.

---

## Step 1: Collect Images with data_set_injector.py

`fish-finder-worker/scripts/data_set_injector.py` downloads research-grade observations from the [iNaturalist API](https://api.inaturalist.org/v1).

**Run it from the `scripts/` directory:**

```bash
cd fish-finder-worker/scripts/
pip install requests
python data_set_injector.py
```

The script iterates over every species key in `fish_dictionary.py`, fetches up to 50 research-grade observations from iNaturalist, and saves:

- `dataset/<species_name>/<n>.jpg` — the image at the highest available resolution
- `dataset/<species_name>/<n>.json` — observation metadata (observer, date, location, photo URL)

A 0.4-second delay between requests keeps usage within iNaturalist's polite-use guidelines.

**Configuration** (edit at the top of `data_set_injector.py`):

| Constant | Default | Description |
|---|---|---|
| `MAX_IMAGES` | `50` | Maximum images to download per species |
| `PER_PAGE` | `50` | Max results per API call (iNaturalist limit) |

To increase the dataset for production, raise `MAX_IMAGES`. The iNaturalist API paginates results; you will need to add pagination logic if you need more than 200 images per species.

---

## Step 2: Prepare and Zip the Dataset

The training script expects a zip file containing the dataset folder:

```bash
cd fish-finder-worker/
zip -r dataset.zip dataset/
```

If you are training on Google Colab (recommended), upload `dataset.zip` to your Colab session or to Google Drive and mount it.

---

## Step 3: Train with train_module.py

`fish-finder-worker/scripts/train_module.py` fine-tunes MobileNetV2 with early stopping.

**Google Colab is recommended** because:
- Free GPU (T4) reduces training time from hours to minutes
- PyTorch and torchvision are pre-installed
- The `files.download()` call at the end automatically triggers a browser download of the `.pth` file

### Running on Colab

1. Create a new Colab notebook.
2. Upload `train_module.py` and `dataset.zip` to the session.
3. Run:

```python
# In a Colab cell:
!python train_module.py
```

The script:

1. Extracts `dataset.zip` to `./fish_data/`
2. Auto-detects the species subfolder (walks until it finds a directory with >1 child)
3. Applies training-time augmentation (resize to 224×224, horizontal flip, rotation ±15°, colour jitter)
4. Loads MobileNetV2 with ImageNet weights
5. Freezes the feature extractor; only the final linear classifier is trained
6. Trains with Adam (lr=0.001), CrossEntropyLoss, up to 20 epochs
7. Stops early if training accuracy reaches 95%
8. Saves weights to `israel_med_fish_v1.pth` and downloads the file

**Configuration** (edit at the top of `train_module.py`):

| Constant | Default | Description |
|---|---|---|
| `BATCH_SIZE` | `32` | Batch size for training |
| `EPOCHS` | `20` | Maximum number of training epochs |
| `TARGET_ACCURACY` | `0.95` | Early stopping threshold |
| `MODEL_SAVE_NAME` | `israel_med_fish_v1.pth` | Output filename |

### Running Locally (CPU)

```bash
cd fish-finder-worker/scripts/
pip install torch torchvision pillow
python train_module.py
```

CPU training is significantly slower (expect 30–60 minutes for 20 epochs on a modern laptop).

---

## Train / Validation / Test Split Recommendation

The current `train_module.py` does not split the dataset — it trains on all images. For production, add a proper split before training:

| Split | Recommended fraction | Purpose |
|---|---|---|
| Train | 70% | Model parameter updates |
| Validation | 15% | Hyperparameter tuning, early stopping |
| Test | 15% | Final unbiased accuracy estimate |

Use `torchvision.datasets.ImageFolder` with a `torch.utils.data.random_split` or organise the dataset into `train/`, `val/`, and `test/` subdirectories manually. Report both validation accuracy (during training) and test accuracy (once, at the end) to avoid overfitting to the validation set.

---

## Class Index Ordering — Critical Note

`torchvision.datasets.ImageFolder` assigns class indices in **alphabetical order of folder names**. The `FishClassifier` in `model_logic.py` reconstructs this mapping with:

```python
self.species_list = sorted(FISH_DATA.keys())
```

This means the class at index 0 in the model corresponds to the first species alphabetically in `FISH_DATA`, index 1 to the second, and so on.

**If you add, remove, or rename a species:**

1. Update `fish_dictionary.py` (add/remove/rename the key).
2. Rename the corresponding folder in `dataset/` to match exactly.
3. Retrain the model from scratch — existing weights are not compatible after the class list changes.
4. Update the `MODEL_SAVE_NAME` to reflect the new version.

Failure to keep these in sync will result in silent misidentification (e.g. the model predicts index 5 which maps to the wrong species name).

---

## Evaluating the Model

After training, evaluate on the held-out test set before deploying:

```python
import torch
from torchvision import models, transforms, datasets
from torch.utils.data import DataLoader
import torch.nn as nn
from fish_dictionary import FISH_DATA

# Load model
num_classes = len(FISH_DATA)
model = models.mobilenet_v2(weights=None)
model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
model.load_state_dict(torch.load("israel_med_fish_v1.pth", map_location="cpu"))
model.eval()

# Test dataset (no augmentation — only resize and normalise)
test_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
test_data = datasets.ImageFolder("dataset/test", test_transform)
test_loader = DataLoader(test_data, batch_size=32, shuffle=False)

correct = total = 0
with torch.no_grad():
    for inputs, labels in test_loader:
        outputs = model(inputs)
        _, predicted = torch.max(outputs, 1)
        total += labels.size(0)
        correct += (predicted == labels).sum().item()

print(f"Test accuracy: {correct / total:.4f}")
```

---

## Model Versioning

### Naming Convention

Use a descriptive name that encodes the key training parameters:

```
israel_med_fish_v<version>_<num_species>cls_<approx_images_per_class>img.pth
```

Examples:

| Filename | Meaning |
|---|---|
| `israel_med_fish_v1.pth` | Version 1, current production model |
| `israel_med_fish_v2_20cls_50img.pth` | v2, 20 classes, 50 images/class |
| `israel_med_fish_v3_50cls_300img.pth` | v3, 50 classes, 300 images/class |

Keep old `.pth` files in `fish-finder-worker/models/` (or an S3 bucket) until the new version is confirmed stable in production.

### Updating the Worker

1. Place the new `.pth` file in `fish-finder-worker/models/` and name it `israel_med_fish_v1.pth` (the filename `model_logic.py` looks for), or update the `MODEL_SAVE_NAME` constant in `model_logic.py` to point to the new file.
2. Run `bash package_worker.sh` to bundle the new model.
3. Follow the deployment steps in `docs/deployment.md → Step 3` to push to EC2.
4. For Lambda: rebuild the Docker image and push to ECR.
