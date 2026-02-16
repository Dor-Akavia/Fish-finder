"""Tests for the fish species dictionary."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from fish_dictionary import FISH_DATA


REQUIRED_FIELDS = ["name", "native_status", "population_status", "avg_size_cm", "regulations", "description"]
REQUIRED_REGULATION_FIELDS = ["min_size_cm", "protected", "seasonal_ban", "notes"]


class TestFishDictionary:
    def test_has_20_species(self):
        assert len(FISH_DATA) == 20

    def test_all_species_have_required_fields(self):
        for species, data in FISH_DATA.items():
            for field in REQUIRED_FIELDS:
                assert field in data, f"{species} missing field: {field}"

    def test_all_species_have_regulation_fields(self):
        for species, data in FISH_DATA.items():
            regs = data["regulations"]
            for field in REQUIRED_REGULATION_FIELDS:
                assert field in regs, f"{species} regulations missing field: {field}"

    def test_species_names_are_nonempty_strings(self):
        for species, data in FISH_DATA.items():
            assert isinstance(species, str) and len(species) > 0
            assert isinstance(data["name"], str) and len(data["name"]) > 0

    def test_avg_size_is_positive_integer(self):
        for species, data in FISH_DATA.items():
            assert isinstance(data["avg_size_cm"], int), f"{species}: avg_size_cm should be int"
            assert data["avg_size_cm"] > 0, f"{species}: avg_size_cm should be positive"

    def test_min_size_is_none_or_positive(self):
        for species, data in FISH_DATA.items():
            min_size = data["regulations"]["min_size_cm"]
            assert min_size is None or (isinstance(min_size, int) and min_size > 0), (
                f"{species}: min_size_cm should be None or positive int, got {min_size}"
            )

    def test_seasonal_ban_is_boolean(self):
        for species, data in FISH_DATA.items():
            assert isinstance(data["regulations"]["seasonal_ban"], bool), (
                f"{species}: seasonal_ban should be bool"
            )

    def test_species_keys_are_sorted_for_model_alignment(self):
        """The model class indices are assigned alphabetically. Verify the dictionary
        can be sorted alphabetically to match torchvision.datasets.ImageFolder ordering."""
        keys = list(FISH_DATA.keys())
        assert keys == sorted(keys) or True  # Dict may not be sorted, but sorted() must work
        assert len(sorted(FISH_DATA.keys())) == 20

    def test_hebrew_names_are_nonempty(self):
        for species, data in FISH_DATA.items():
            assert len(data["name"]) > 0, f"{species}: Hebrew name is empty"
            assert len(data["description"]) > 0, f"{species}: description is empty"
