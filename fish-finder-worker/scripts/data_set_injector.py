import requests
import json
import time
from pathlib import Path
from fish_dictionary import FISH_DATA

BASE_URL = "https://api.inaturalist.org/v1/observations"
MAX_IMAGES = 50
PER_PAGE = 50  # max allowed per API call


def get_observations(species_name):
    params = {
        "taxon_name": species_name,
        "quality_grade": "research",
        "photos": "true",
        "per_page": PER_PAGE,
        "order": "desc",
        "order_by": "created_at"
    }

    response = requests.get(BASE_URL, params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def get_best_photo_url(photo_obj):
    url = photo_obj.get("url")
    if not url:
        return None

    # upgrade resolution
    return url.replace("square", "large")


def download_image(url, path):
    img = requests.get(url, timeout=15)
    img.raise_for_status()
    with open(path, "wb") as f:
        f.write(img.content)


def download_species(species_name, base_path: Path):
    print(f"\n=== Processing {species_name} ===")

    species_path = base_path / species_name
    species_path.mkdir(parents=True, exist_ok=True)

    try:
        data = get_observations(species_name)
    except Exception as e:
        print(f"Failed fetching {species_name}: {e}")
        return

    if not data.get("results"):
        print(f"No results found for {species_name}")
        return

    image_count = 0
    seen_urls = set()

    for observation in data["results"]:
        if image_count >= MAX_IMAGES:
            break

        for photo in observation.get("photos", []):
            if image_count >= MAX_IMAGES:
                break

            photo_url = get_best_photo_url(photo)
            if not photo_url or photo_url in seen_urls:
                continue

            try:
                image_count += 1
                seen_urls.add(photo_url)

                image_path = species_path / f"{image_count}.jpg"
                metadata_path = species_path / f"{image_count}.json"

                print(f"Downloading {image_count}: {photo_url}")
                download_image(photo_url, image_path)

                metadata = {
                    "species": species_name,
                    "observation_id": observation.get("id"),
                    "observed_on": observation.get("observed_on"),
                    "location": observation.get("location"),
                    "photo_url": photo_url,
                    "observer": observation.get("user", {}).get("login"),
                }

                with open(metadata_path, "w") as meta_file:
                    json.dump(metadata, meta_file, indent=2)

                time.sleep(0.4)  # polite API usage

            except Exception as e:
                print(f"Skipping image due to error: {e}")
                continue

    print(f"Downloaded {image_count} images for {species_name}")


if __name__ == "__main__":
    base_path = Path("..") / "dataset"
    base_path.mkdir(parents=True, exist_ok=True)

    for fish in FISH_DATA:
        download_species(fish, base_path)

    print("\nDone.")
