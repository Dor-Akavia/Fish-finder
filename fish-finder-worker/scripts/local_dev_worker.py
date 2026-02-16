import json
from pathlib import Path
from model_logic import FishClassifier

# Paths
# Since this script is in /scripts/, .parent is /scripts/ and .parent.parent is /fish-finder-worker/
BASE_DIR = Path(__file__).resolve().parent.parent
MOCK_JSON = BASE_DIR / "tests" / "mock_event.json"
TEST_IMAGE = BASE_DIR / "tests" / "test_fish_image.jpg"

print("--- [LOCAL] Initializing Fish-Finder ML ---")
classifier = FishClassifier()


def run_local_test():
    # Check if files exist
    if not MOCK_JSON.exists() or not TEST_IMAGE.exists():
        print("--- ERROR: Missing Files ---")
        print(f"Looking for JSON at: {MOCK_JSON}")
        print(f"Looking for Image at: {TEST_IMAGE}")
        return

    print(f"Reading mock event: {MOCK_JSON.name}")
    with open(MOCK_JSON, "r") as f:
        json.load(f)  # validate JSON is well-formed

    # Run the ML logic - returns (species, data, confidence)
    species_en, data, confidence = classifier.predict(str(TEST_IMAGE))

    print("\n" + "=" * 40)
    print(f"IDENTIFIED:   {species_en}")
    print(f"CONFIDENCE:   {confidence:.1%}{'  ⚠️  LOW - consider adding to dataset' if confidence < 0.70 else ''}")
    print(f"HEBREW:       {data['name']}")
    print(f"NATIVE:       {data['native_status']}")
    print(f"POPULATION:   {data['population_status']}")
    print(f"AVERAGE SIZE: {data['avg_size_cm']} cm")

    # Chained brackets to reach the nested value
    print(f"MINIMUM SIZE: {data['regulations']['min_size_cm']} cm")

    # Optional: Add a check for the seasonal ban
    ban_status = "Yes" if data["regulations"]["seasonal_ban"] else "No"
    print(f"SEASONAL BAN: {ban_status}")

    print(f"NOTES:        {data['regulations']['notes']}")
    print(f"DESCRIPTION:  {data['description']}")
    print("=" * 40)


if __name__ == "__main__":
    run_local_test()
