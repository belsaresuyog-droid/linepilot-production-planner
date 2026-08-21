import sqlite3
import unittest
from datetime import datetime
from pathlib import Path

from mes_oee_service import MesOeeService, ProductionUpdate


ROOT = Path(__file__).resolve().parents[1]


class MesOeeServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript((ROOT / "db" / "schema_v2.sql").read_text())
        self.db.executescript((ROOT / "db" / "seed_v2.sql").read_text())

    def tearDown(self):
        self.db.close()

    def test_oee_formula(self):
        result = MesOeeService.calculate_oee(ProductionUpdate(
            station_id=1, production_order_id=None, actual_output=90, good_output=81,
            planned_output_at_checkpoint=100, runtime_seconds=900,
            planned_runtime_seconds=1000, ideal_cycle_time_seconds=8,
            machine_count_available=1, machine_count_required=1,
            manpower_available=1, manpower_required=1,
        ))
        self.assertAlmostEqual(result.availability, 0.9)
        self.assertAlmostEqual(result.performance, 0.8)
        self.assertAlmostEqual(result.quality, 0.9)
        self.assertAlmostEqual(result.oee, 0.648)

    def test_ingest_creates_auditable_adjustments(self):
        service = MesOeeService(self.db)
        ids = service.ingest_updates(
            site_id=1,
            capacity_plan_id=1,
            observed_at=datetime(2026, 8, 3, 12, 30),
            updates=[ProductionUpdate(
                station_id=1, production_order_id=1, actual_output=40, good_output=39,
                planned_output_at_checkpoint=100, runtime_seconds=900,
                planned_runtime_seconds=1800, ideal_cycle_time_seconds=8,
                machine_count_available=0, machine_count_required=1,
                manpower_available=0, manpower_required=1, downtime_reason="PM",
            )],
        )
        self.assertGreaterEqual(len(ids), 3)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM telemetry_logs").fetchone()[0], 1)

    def test_rejects_non_checkpoint_time(self):
        service = MesOeeService(self.db)
        with self.assertRaises(ValueError):
            service.checkpoint_label(datetime(2026, 8, 3, 14, 0))


if __name__ == "__main__":
    unittest.main()
