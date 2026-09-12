#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release" / "generated" / "V5.7.2-DEV"
MANIFEST = OUT / "RECOVERY_MANIFEST.json"
fail = []


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require(cond, message):
    if not cond:
        fail.append(message)


require(MANIFEST.exists(), "RECOVERY_MANIFEST.json missing")
if not MANIFEST.exists():
    print("Recovery artifact check FAILED")
    print("- RECOVERY_MANIFEST.json missing")
    sys.exit(1)

m = json.loads(MANIFEST.read_text(encoding="utf-8"))
require(m.get("historical_binary_identity_claimed") is False, "Historical binary identity must not be claimed")
require(m.get("canonical_card_designs") == 111, "Expected 111 canonical card designs")
require(m.get("known_physical_card_copies") == 120, "Expected 120 known physical card copies")
require(m.get("card_pages_a4_3x3") == 14, "Expected 14 A4 pages at 3x3")

records = {r["file"]: r for r in m.get("artifacts", [])}
for name, rec in records.items():
    path = OUT / name
    require(path.exists(), f"Artifact missing: {name}")
    if path.exists():
        require(path.stat().st_size == rec.get("bytes"), f"Byte count mismatch: {name}")
        require(sha256(path) == rec.get("sha256"), f"SHA mismatch: {name}")

pdf = OUT / "Жестокий_Век_Карточки_Current_120.pdf"
html = OUT / "Жестокий_Век_Карточки_Current_120.html"
individual = OUT / "Жестокий_Век_Карточки_Individual_Current_120.zip"
visual = OUT / "Жестокий_Век_Visual_Current_Pack.zip"
arena = OUT / "Жестокий_Век_Arena_Recovery_Source_Pack.zip"
source = OUT / "Жестокий_Век_Current_Project_Source_Pack.zip"

try:
    from pypdf import PdfReader
    if pdf.exists():
        reader = PdfReader(str(pdf))
        require(len(reader.pages) == 14, f"Card PDF page count {len(reader.pages)} != 14")
        for i, page in enumerate(reader.pages):
            w = float(page.mediabox.width)
            h = float(page.mediabox.height)
            require(590 <= w <= 600 and 838 <= h <= 848, f"Page {i+1} is not A4: {w}x{h}")
except Exception as exc:
    fail.append(f"PDF structural verification failed: {exc}")

if html.exists():
    text = html.read_text(encoding="utf-8")
    require(text.count('<section class="card">') == 120, "Card HTML does not contain 120 physical card sections")
    require("@page{size:A4" in text, "Card HTML missing A4 print rule")
    require("69mm" in text and "94mm" in text and "63mm" in text and "88mm" in text, "Card HTML missing canonical print geometry")

if individual.exists():
    with zipfile.ZipFile(individual) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".pdf")]
        require(len(names) == 120, f"Individual PDF ZIP contains {len(names)} PDFs instead of 120")

if visual.exists():
    with zipfile.ZipFile(visual) as z:
        names = set(z.namelist())
        require("Жестокий_Век_Карточки_Current_120.pdf" in names, "Visual pack missing current card PDF")
        require("Жестокий_Век_Карточки_Current_120.html" in names, "Visual pack missing current card HTML")
        require("Жестокий_Век_Карточки_Individual_Current_120.zip" in names, "Visual pack missing individual-card ZIP")
        require(any(n.endswith("Жестокий_Век_Карта_Topology_Preview_V5.7.2.pdf") for n in names), "Visual pack missing current topology preview PDF")
        require(any(n.endswith("Жестокий_Век_Референсы_оформления.pdf") for n in names), "Visual pack missing visual reference PDF")

if arena.exists():
    with zipfile.ZipFile(arena) as z:
        names = set(z.namelist())
        require("ai/config/canonical_v5.7.2.json" in names, "Arena recovery pack missing AI config")
        require("arena/source/patches/v5.7.2_rc2_engine_delta.js" in names, "Arena recovery pack missing engine delta")
        require("data/master_game_data_v5.7.2-dev.json" in names, "Arena recovery pack missing MGD")
        require("rules/source/04_arena_technical_appendix.md" in names, "Arena recovery pack missing Arena technical rules")
        require(not any(n.endswith("Жестокий_Век_Arena_V5.7.2_PLAYABLE_RC2.html") for n in names), "Arena recovery pack must not pretend lost RC2 executable exists")

if source.exists():
    with zipfile.ZipFile(source) as z:
        names = set(z.namelist())
        require("cards/canonical_registry_v5.7.2.json" in names, "Source pack missing card registry")
        require("release/repository_completeness_v5.7.2.json" in names, "Source pack missing completeness inventory")
        require(not any(n.startswith("release/generated/") for n in names), "Source pack recursively contains generated artifacts")
        require(not any(n.startswith(".git/") for n in names), "Source pack contains .git")

if fail:
    print("Recovery artifact check FAILED")
    for message in fail:
        print(f"- {message}")
    sys.exit(1)

print("Recovery artifact check OK")
print("- 111 designs / 120 physical cards")
print("- 14 A4 card pages")
print("- 120 individual card PDFs")
print("- current visual/source recovery packs present")
print("- historical missing binaries are not falsely claimed")
