"""Reference catalog consistency and the boundary to paid authorization."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("commercial_catalog", ROOT / "tools/public-site/plan_catalog.py")
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class CommercialCatalogTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(catalog.CONTRACT.read_text(encoding="utf-8"))

    def load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return catalog.load_catalog(path)

    def test_changed_authority_price_and_capacity_reach_the_presentation(self):
        source = copy.deepcopy(self.contract)
        offer = source["plan_catalog"]["plans"][1]["commercial_offer"]
        offer["monthly_price_minor"] = 6173
        offer["reference_capacity"]["storage_bytes"] = 73000000000
        markup = catalog.render_catalog(self.load(source))
        self.assertIn("R$ 61,73", markup)
        self.assertIn('translate="no">73</strong>', markup)
        self.assertNotIn("R$ 49,90", markup)
        self.assertNotIn("<button", markup)
        self.assertNotIn("<form", markup)
        self.assertNotIn("checkout", markup)

    def test_reference_catalog_cannot_activate_billing_or_paid_capacity(self):
        for section, key in (("commercial_policy", "billing_implemented"),
                             ("plan_catalog", "purchasable_paid_plans_enabled"),
                             ("plan_catalog", "commercial_capacity_allocation_enabled")):
            source = copy.deepcopy(self.contract)
            source[section][key] = True
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load(source)

    def test_money_and_capacity_reject_boolean_fractional_and_negative_values(self):
        for value in (True, -1, 12.5, "4990"):
            for key in ("monthly_price_minor", "storage_bytes"):
                source = copy.deepcopy(self.contract)
                offer = source["plan_catalog"]["plans"][1]["commercial_offer"]
                if key == "monthly_price_minor":
                    offer[key] = value
                else:
                    offer["reference_capacity"][key] = value
                with self.subTest(value=value, key=key), self.assertRaises(ValueError):
                    self.load(source)

    def test_additional_offers_cannot_duplicate_or_reference_unknown_plans(self):
        source = copy.deepcopy(self.contract)
        source["plan_catalog"]["additional_offers"][0]["included_in"] = ["unknown"]
        with self.assertRaises(ValueError):
            self.load(source)
        source = copy.deepcopy(self.contract)
        source["plan_catalog"]["additional_offers"].append(source["plan_catalog"]["additional_offers"][0])
        with self.assertRaises(ValueError):
            self.load(source)

    def test_catalog_text_is_escaped_and_not_a_grant(self):
        source = copy.deepcopy(self.contract)
        source["plan_catalog"]["plans"][0]["display_name"] = '<script>alert("x")</script>'
        markup = catalog.render_catalog(self.load(source))
        self.assertNotIn("<script>", markup)
        self.assertIn("&lt;script&gt;", markup)
        self.assertFalse(self.contract["plan_catalog"]["commercial_capacity_allocation_enabled"])
        self.assertTrue(self.contract["commercial_policy"]["only_free_assignable_before_billing_activation"])


if __name__ == "__main__":
    unittest.main()
