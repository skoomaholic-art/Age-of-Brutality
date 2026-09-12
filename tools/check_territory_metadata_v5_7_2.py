#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOPO = json.loads((ROOT / "map/canonical_topology_v5.7.2.json").read_text(encoding="utf-8"))
META = json.loads((ROOT / "map/territory_metadata_v5.7.2.json").read_text(encoding="utf-8"))
ROWS = META["territories"]

expected_resistance = {
    "Столица": None,
    "Город": 2,
    "Деревня": 1,
    "Дикая земля": 0,
    "Половина центрального острова": 1,
}
expected_counts = {
    "Столица": 6,
    "Город": 6,
    "Деревня": 18,
    "Дикая земля": 12,
    "Половина центрального острова": 10,
}

ids = [r["id"] for r in ROWS]
legacy = [r["legacy_arena_id"] for r in ROWS]
assert len(ROWS) == 52, len(ROWS)
assert len(ids) == len(set(ids)), "duplicate current territory IDs"
assert len(legacy) == len(set(legacy)), "duplicate legacy territory IDs"
assert set(ids) == set(TOPO["territories"]), "metadata/topology territory ID mismatch"
assert Counter(r["type"] for r in ROWS) == Counter(expected_counts), Counter(r["type"] for r in ROWS)

for row in ROWS:
    assert row["type"] in expected_resistance, row
    assert row["resistance"] == expected_resistance[row["type"]], row

capitals = TOPO["capitals"]
for house, tid in capitals.items():
    row = next(r for r in ROWS if r["id"] == tid)
    assert row["type"] == "Столица", (house, row)
    assert row["house_sector"] == house, (house, row)

# Island bonus text intentionally does not live here. The historical RC1 S03
# bonus is stale; active V5.7.2 Rules/MGD are canonical for S01..S05 bonuses.
assert all("bonus" not in r and "income" not in r for r in ROWS)

print("territory metadata: OK — 52/52 IDs, types and resistance match current V5.7.2")
