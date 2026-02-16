import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import models, transforms, datasets
import time
import zipfile
import os

# --- 1. SETUP & CONFIGURATION ---
DATA_ZIP = "dataset.zip"
EXTRACT_PATH = "./fish_data"
MODEL_SAVE_NAME = "israel_med_fish_v1.pth"
BATCH_SIZE = 32
EPOCHS = 20  # Increased limit, but Early Stopping will likely catch it sooner
TARGET_ACCURACY = 0.95  # The script will stop once we hit 95% accuracy

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"✅ Training on: {device}")

# --- 2. EXTRACT DATA ---
if not os.path.exists(EXTRACT_PATH):
    print("📂 Unzipping dataset...")
    with zipfile.ZipFile(DATA_ZIP, 'r') as zip_ref:
        zip_ref.extractall(EXTRACT_PATH)
    print("✅ Extraction Complete!")

# Logic to find the folder containing species subfolders
data_dir = EXTRACT_PATH
for root, dirs, files in os.walk(EXTRACT_PATH):
    if len(dirs) > 1:
        data_dir = root
        break
print(f"🎯 Data directory set to: {data_dir}")

# --- 3. PREPARE IMAGES ---
data_transforms = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

image_dataset = datasets.ImageFolder(data_dir, data_transforms)
dataloader = torch.utils.data.DataLoader(image_dataset, batch_size=BATCH_SIZE, shuffle=True)
class_names = image_dataset.classes
print(f"🐟 Found {len(class_names)} species.")

# --- 4. BUILD MODEL ---
model = models.mobilenet_v2(weights="IMAGENET1K_V1")
for param in model.features.parameters():
    param.requires_grad = False

num_ftrs = model.classifier[1].in_features
model.classifier[1] = nn.Linear(num_ftrs, len(class_names))
model = model.to(device)

# --- 5. TRAIN WITH EARLY STOPPING ---
criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.classifier.parameters(), lr=0.001)

print("\n🚀 STARTING TRAINING...")
start_time = time.time()

for epoch in range(EPOCHS):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for inputs, labels in dataloader:
        inputs, labels = inputs.to(device), labels.to(device)
        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        running_loss += loss.item() * inputs.size(0)
        _, predicted = torch.max(outputs, 1)
        total += labels.size(0)
        correct += (predicted == labels).sum().item()

    epoch_loss = running_loss / len(image_dataset)
    epoch_acc = correct / total

    print(f"Epoch {epoch+1}/{EPOCHS} | Loss: {epoch_loss:.4f} | Accuracy: {epoch_acc:.4f}")

    # --- EARLY STOPPING LOGIC ---
    if epoch_acc >= TARGET_ACCURACY:
        print(f"\n🎯 Target accuracy of {TARGET_ACCURACY*100}% reached!")
        print("Stopping training early to prevent overfitting.")
        break

time_elapsed = time.time() - start_time
print(f"\n✅ Finished in {time_elapsed // 60:.0f}m {time_elapsed % 60:.0f}s")

# --- 6. SAVE & DOWNLOAD ---
torch.save(model.state_dict(), MODEL_SAVE_NAME)
try:
    from google.colab import files
    files.download(MODEL_SAVE_NAME)
    print("⬇️ Download started!")
except Exception:
    print("Check the 'Files' tab in Colab to download your .pth file.")
