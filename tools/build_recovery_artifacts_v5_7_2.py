#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release" / "generated" / "V5.7.2-DEV"
CARDS_DIR = OUT / "individual_cards"
REGISTRY_PATH = ROOT / "cards" / "canonical_registry_v5.7.2.json"
CARD_SET_PATH = ROOT / "cards" / "canonical_card_set_v5.7.2.json"
FIXED_ZIP_TIME = (2026, 9, 12, 0, 0, 0)
CARD_SHEET_ORDER = ["Events", "Houses", "Characters", "Advisors", "Ambitions", "Intrigues"]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "UNKNOWN"


def clean_output():
    if OUT.exists():
        shutil.rmtree(OUT)
    CARDS_DIR.mkdir(parents=True, exist_ok=True)


def positive_int(value, default=1) -> int:
    try:
        n = int(value)
        return n if n > 0 else default
    except Exception:
        return default


def row_identity(sheet: str, row: dict, index: int) -> str:
    for key in ("__registry_id", "REGISTRY_ID", "CARD_ID", "ID"):
        v = str(row.get(key, "")).strip()
        if v:
            return v
    return f"ROW-{sheet}-{index + 1:03d}"


def title_for(row: dict) -> str:
    for key in ("Название", "Имя", "Дом", "Тип", "CARD_ID", "ID"):
        v = str(row.get(key, "")).strip()
        if v and v != "—":
            return v
    return "Без названия"


def visible_fields(row: dict) -> list[tuple[str, str]]:
    out = []
    for key, value in row.items():
        if str(key).startswith("__"):
            continue
        if value is None:
            continue
        if isinstance(value, (dict, list)):
            text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        else:
            text = str(value).strip()
        if text == "":
            continue
        out.append((str(key), text))
    return out


def physical_cards(registry: dict) -> list[dict]:
    cards = []
    sheets = registry.get("sheets", {})
    ordered_sheets = [s for s in CARD_SHEET_ORDER if s in sheets]
    ordered_sheets += [s for s in sheets if s not in ordered_sheets]
    for sheet in ordered_sheets:
        rows = sheets.get(sheet) or []
        for index, row in enumerate(rows):
            copies = positive_int(row.get("Копий"), 1)
            rid = row_identity(sheet, row, index)
            for copy_index in range(1, copies + 1):
                cards.append({
                    "sheet": sheet,
                    "row_index": index,
                    "registry_id": rid,
                    "copy_index": copy_index,
                    "copy_count": copies,
                    "row": row,
                })
    return cards


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[^0-9A-Za-z._-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_.")
    return value or "card"


def locate_fonts():
    candidates = [
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
        (
            Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            return regular, bold
    raise RuntimeError("DejaVu Sans fonts not found; install fonts-dejavu-core")


def pdf_support():
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.lib.units import mm
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception as exc:
        raise RuntimeError("ReportLab is required: pip install reportlab") from exc
    regular, bold = locate_fonts()
    pdfmetrics.registerFont(TTFont("ZV-DejaVu", str(regular)))
    pdfmetrics.registerFont(TTFont("ZV-DejaVu-Bold", str(bold)))
    return pdfmetrics, mm, A4, canvas


def wrap_text(pdfmetrics, text: str, font_name: str, font_size: float, max_width: float) -> list[str]:
    text = re.sub(r"\s+", " ", text.strip())
    if not text:
        return [""]
    words = text.split(" ")
    lines = []
    current = ""
    for word in words:
        probe = word if not current else current + " " + word
        if pdfmetrics.stringWidth(probe, font_name, font_size) <= max_width:
            current = probe
            continue
        if current:
            lines.append(current)
            current = ""
        if pdfmetrics.stringWidth(word, font_name, font_size) <= max_width:
            current = word
            continue
        chunk = ""
        for ch in word:
            probe2 = chunk + ch
            if chunk and pdfmetrics.stringWidth(probe2, font_name, font_size) > max_width:
                lines.append(chunk)
                chunk = ch
            else:
                chunk = probe2
        current = chunk
    if current:
        lines.append(current)
    return lines or [""]


def fit_body(pdfmetrics, fields: list[tuple[str, str]], max_width: float, max_height: float):
    for font_size in [5.4, 5.1, 4.8, 4.5, 4.2, 3.9, 3.6, 3.3, 3.0, 2.8]:
        leading = font_size * 1.22
        lines = []
        for key, value in fields:
            prefix = f"{key}: "
            wrapped = wrap_text(pdfmetrics, prefix + value, "ZV-DejaVu", font_size, max_width)
            lines.extend(wrapped)
        required = len(lines) * leading
        if required <= max_height:
            return font_size, leading, lines
    font_size = 2.6
    leading = font_size * 1.18
    lines = []
    for key, value in fields:
        lines.extend(wrap_text(pdfmetrics, f"{key}: {value}", "ZV-DejaVu", font_size, max_width))
    if len(lines) * leading > max_height:
        raise RuntimeError(f"Card text cannot fit without omission: {len(lines)} lines")
    return font_size, leading, lines


def draw_card(c, card: dict, x: float, y: float, full_w: float, full_h: float, pdfmetrics, mm):
    row = card["row"]
    trim_x = x + 3 * mm
    trim_y = y + 3 * mm
    trim_w = 63 * mm
    trim_h = 88 * mm
    c.setLineWidth(0.25)
    c.rect(x, y, full_w, full_h, stroke=1, fill=0)
    c.setLineWidth(0.5)
    c.rect(trim_x, trim_y, trim_w, trim_h, stroke=1, fill=0)

    pad = 2.4 * mm
    text_x = trim_x + pad
    max_width = trim_w - 2 * pad
    top = trim_y + trim_h - pad

    title = title_for(row)
    title_size = 8.2
    while title_size > 5.2 and pdfmetrics.stringWidth(title, "ZV-DejaVu-Bold", title_size) > max_width:
        title_size -= 0.3
    if pdfmetrics.stringWidth(title, "ZV-DejaVu-Bold", title_size) > max_width:
        title_lines = wrap_text(pdfmetrics, title, "ZV-DejaVu-Bold", title_size, max_width)[:2]
    else:
        title_lines = [title]
    c.setFont("ZV-DejaVu-Bold", title_size)
    ty = top - title_size
    for line in title_lines:
        c.drawString(text_x, ty, line)
        ty -= title_size * 1.12

    meta = card["sheet"]
    if card["registry_id"]:
        meta += f" · {card['registry_id']}"
    if card["copy_count"] > 1:
        meta += f" · копия {card['copy_index']}/{card['copy_count']}"
    meta_size = 4.8
    c.setFont("ZV-DejaVu", meta_size)
    c.drawString(text_x, ty - meta_size, meta)
    body_top = ty - meta_size * 2.0

    fields = visible_fields(row)
    # Title is already printed, but canonical field remains in body only when it carries additional semantics.
    body_height = body_top - (trim_y + pad + 2.5 * mm)
    font_size, leading, lines = fit_body(pdfmetrics, fields, max_width, body_height)
    c.setFont("ZV-DejaVu", font_size)
    yy = body_top - font_size
    for line in lines:
        c.drawString(text_x, yy, line)
        yy -= leading

    c.setFont("ZV-DejaVu", 3.7)
    c.drawRightString(trim_x + trim_w - pad, trim_y + 1.3 * mm, "V5.7.2-DEV canonical data")


def build_cards_pdf(cards: list[dict], output: Path):
    pdfmetrics, mm, A4, canvas = pdf_support()
    full_w = 69 * mm
    full_h = 94 * mm
    page_w, page_h = A4
    x0 = (page_w - 3 * full_w) / 2
    y0 = (page_h - 3 * full_h) / 2
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1, invariant=1)
    c.setTitle("Жестокий Век - Current 120 Card Preprint")
    for i, card in enumerate(cards):
        slot = i % 9
        col = slot % 3
        row = slot // 3
        x = x0 + col * full_w
        y = page_h - y0 - (row + 1) * full_h
        draw_card(c, card, x, y, full_w, full_h, pdfmetrics, mm)
        if slot == 8 or i == len(cards) - 1:
            c.showPage()
    c.save()


def build_individual_pdfs(cards: list[dict]):
    pdfmetrics, mm, _A4, canvas = pdf_support()
    full_w = 69 * mm
    full_h = 94 * mm
    manifest = []
    for i, card in enumerate(cards, start=1):
        rid = sanitize_filename(card["registry_id"])
        filename = f"{i:03d}_{sanitize_filename(card['sheet'])}_{rid}_copy-{card['copy_index']}.pdf"
        output = CARDS_DIR / filename
        c = canvas.Canvas(str(output), pagesize=(full_w, full_h), pageCompression=1, invariant=1)
        c.setTitle(f"Жестокий Век - {title_for(card['row'])}")
        draw_card(c, card, 0, 0, full_w, full_h, pdfmetrics, mm)
        c.showPage()
        c.save()
        manifest.append({"file": filename, "sha256": sha256(output), "bytes": output.stat().st_size})
    return manifest


def build_cards_html(cards: list[dict], output: Path):
    blocks = []
    for card in cards:
        row = card["row"]
        fields = []
        for key, value in visible_fields(row):
            fields.append(f'<div class="field"><b>{html.escape(key)}</b>: {html.escape(value)}</div>')
        meta = html.escape(card["sheet"] + " · " + card["registry_id"])
        if card["copy_count"] > 1:
            meta += html.escape(f" · копия {card['copy_index']}/{card['copy_count']}")
        blocks.append(
            '<section class="card">'
            '<div class="trim">'
            f'<h2>{html.escape(title_for(row))}</h2>'
            f'<div class="meta">{meta}</div>'
            f'<div class="body">{"".join(fields)}</div>'
            '<div class="foot">V5.7.2-DEV canonical data</div>'
            '</div></section>'
        )
    doc = f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Жестокий Век - Current 120 Card Preprint</title>
<style>
@page{{size:A4;margin:7.5mm 1.5mm}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:"DejaVu Sans",Arial,sans-serif;color:#111}}
.sheet{{width:207mm;display:grid;grid-template-columns:repeat(3,69mm);grid-auto-rows:94mm;gap:0;page-break-after:auto}}
.card{{width:69mm;height:94mm;border:.2mm solid #777;padding:3mm;break-inside:avoid;page-break-inside:avoid}}
.trim{{width:63mm;height:88mm;border:.35mm solid #111;padding:2.4mm;display:flex;flex-direction:column;overflow:hidden}}
h2{{font-size:8pt;line-height:1.05;margin:0 0 1mm}}
.meta{{font-size:4.8pt;margin-bottom:1.2mm}}
.body{{font-size:4.2pt;line-height:1.18;overflow:hidden;flex:1}}
.field{{margin:0 0 .35mm;overflow-wrap:anywhere}}
.foot{{font-size:3.7pt;text-align:right;margin-top:.5mm}}
@media print{{body{{width:210mm}}}}
</style></head><body><main class="sheet">{''.join(blocks)}</main></body></html>'''
    output.write_text(doc, encoding="utf-8")


def zip_add_bytes(zf: zipfile.ZipFile, arcname: str, data: bytes):
    info = zipfile.ZipInfo(arcname.replace(os.sep, "/"), FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    zf.writestr(info, data)


def deterministic_zip(output: Path, files: Iterable[tuple[Path, str]]):
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path, arcname in sorted(files, key=lambda x: x[1]):
            zip_add_bytes(zf, arcname, path.read_bytes())


def files_under(rel_paths: list[str], exclude_prefixes: tuple[str, ...] = ()) -> list[tuple[Path, str]]:
    out = []
    for rel in rel_paths:
        base = ROOT / rel
        if not base.exists():
            continue
        if base.is_file():
            candidates = [base]
        else:
            candidates = [p for p in base.rglob("*") if p.is_file()]
        for p in candidates:
            rp = p.relative_to(ROOT).as_posix()
            if rp.startswith(".git/"):
                continue
            if any(rp.startswith(prefix) for prefix in exclude_prefixes):
                continue
            out.append((p, rp))
    return out


def build_source_pack(output: Path):
    candidates = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        rp = p.relative_to(ROOT).as_posix()
        if rp.startswith(".git/") or rp.startswith("release/generated/"):
            continue
        if rp.endswith(".tmp") or "/__pycache__/" in rp:
            continue
        candidates.append((p, rp))
    deterministic_zip(output, candidates)


def write_recovery_readme(output: Path, card_count: int):
    text = f"""# Жестокий Век - V5.7.2-DEV Recovery Build

This directory contains artifacts reproducibly generated from the current repository sources.

Generated now:
- `Жестокий_Век_Карточки_Current_{card_count}.pdf` - base-MGD preprint ({card_count} instances); the explicit 40-card Intrigue module is packaged separately by the current delivery workflow.
- `Жестокий_Век_Карточки_Current_{card_count}.html` - editable/printable static HTML of the same base set.
- `Жестокий_Век_Карточки_Individual_Current_{card_count}.zip` - individual one-card PDFs for the base set.
- `Жестокий_Век_Visual_Current_Pack.zip` - current reproducible visual/preprint sources and generated card artifacts.
- `Жестокий_Век_Arena_Recovery_Source_Pack.zip` - every currently available Arena/AI/rules/data/QA source needed for reconstruction work.
- `Жестокий_Век_Current_Project_Source_Pack.zip` - source snapshot of the current repository, excluding generated recovery artifacts and `.git`.

These files DO NOT claim binary identity with lost historical artifacts.

Historical binaries intentionally not recreated:
- historical `Жестокий_Век_Arena_V5.7.2_PLAYABLE_RC2.html`, superseded as a working dependency by the reproducible current DEV Arena,
- historical styled Arena derived from that executable,
- historical illustrated map SVG/PDF (editable illustrated master absent),
- historical 160-card PDF/pack (current data are complete, but binary/art identity is not claimed),
- latest missing raw manual playtest logs and complete component BOM.

The current card PDF is a technical preprint generated verbatim from canonical card registry data. It is not a final illustrated art master.
"""
    output.write_text(text, encoding="utf-8")


def artifact_record(path: Path, kind: str, status: str, note: str = "") -> dict:
    return {
        "file": path.name,
        "path": path.relative_to(ROOT).as_posix(),
        "kind": kind,
        "status": status,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "note": note,
    }


def main():
    clean_output()
    registry = read_json(REGISTRY_PATH)
    card_set = read_json(CARD_SET_PATH)
    cards = physical_cards(registry)
    design_count = int(registry.get("object_count", 0))
    if design_count != 111:
        raise RuntimeError(f"Expected current registry design count 111, got {design_count}")
    if len(cards) != 120:
        raise RuntimeError(f"Expected current physical card count 120, got {len(cards)}")

    cards_pdf = OUT / f"Жестокий_Век_Карточки_Current_{len(cards)}.pdf"
    cards_html = OUT / f"Жестокий_Век_Карточки_Current_{len(cards)}.html"
    individual_zip = OUT / f"Жестокий_Век_Карточки_Individual_Current_{len(cards)}.zip"
    visual_zip = OUT / "Жестокий_Век_Visual_Current_Pack.zip"
    arena_zip = OUT / "Жестокий_Век_Arena_Recovery_Source_Pack.zip"
    source_zip = OUT / "Жестокий_Век_Current_Project_Source_Pack.zip"
    readme = OUT / "README.md"

    build_cards_pdf(cards, cards_pdf)
    individual_manifest = build_individual_pdfs(cards)
    build_cards_html(cards, cards_html)
    deterministic_zip(individual_zip, [(p, p.name) for p in CARDS_DIR.glob("*.pdf")])

    visual_inputs = files_under([
        "visual/docs",
        "visual/templates",
        "visual/html_v22",
        "visual/map",
        "docs/references/visual_style",
        "cards/canonical_registry_v5.7.2.json",
    ])
    visual_inputs += [
        (cards_pdf, cards_pdf.name),
        (cards_html, cards_html.name),
        (individual_zip, individual_zip.name),
    ]
    deterministic_zip(visual_zip, visual_inputs)

    arena_inputs = files_under([
        "arena",
        "ai",
        "data",
        "rules",
        "qa/game-master",
        "qa/reports",
        "map/canonical_topology_v5.7.2.json",
        "docs/KNOWN_ISSUES.md",
        "release/repository_completeness_v5.7.2.json",
    ], exclude_prefixes=("arena/builds/Жестокий_Век_Arena_",))
    deterministic_zip(arena_zip, arena_inputs)

    build_source_pack(source_zip)
    write_recovery_readme(readme, len(cards))

    # Individual PDFs remain inside the ZIP; keep the repository compact.
    shutil.rmtree(CARDS_DIR)

    generated = [cards_pdf, cards_html, individual_zip, visual_zip, arena_zip, source_zip, readme]
    artifacts = [
        artifact_record(cards_pdf, "cards_pdf", "CURRENT_REPRODUCIBLE", f"{len(cards)} physical cards / {math.ceil(len(cards)/9)} A4 pages"),
        artifact_record(cards_html, "cards_html", "CURRENT_REPRODUCIBLE", "Static printable HTML generated from canonical registry"),
        artifact_record(individual_zip, "individual_card_pdfs_zip", "CURRENT_REPRODUCIBLE", f"{len(individual_manifest)} one-card PDFs"),
        artifact_record(visual_zip, "visual_preprint_pack", "CURRENT_REPRODUCIBLE_PARTIAL", "Base-card preprint only; the current Intrigue preprint is distributed separately"),
        artifact_record(arena_zip, "arena_source_pack", "CURRENT_REPRODUCIBLE", "Includes the current standalone Arena plus historical recovery provenance"),
        artifact_record(source_zip, "project_source_snapshot", "CURRENT_REPRODUCIBLE", "Excludes .git and release/generated"),
        artifact_record(readme, "recovery_notes", "CURRENT_REPRODUCIBLE"),
    ]

    manifest = {
        "schema_version": "1.0",
        "game_version": "V5.7.2-DEV",
        "build_type": "RECOVERY_FROM_CURRENT_CANONICAL_SOURCES",
        "source_commit": git_head(),
        "base_card_designs": design_count,
        "base_physical_card_copies": len(cards),
        "canonical_card_designs": int(card_set["design_count"]),
        "known_physical_card_copies": int(card_set["physical_copy_count"]),
        "card_pages_a4_3x3": math.ceil(len(cards) / 9),
        "historical_binary_identity_claimed": False,
        "artifacts": artifacts,
        "historical_artifacts_not_recreated": [
            "ARENA-RC2-HTML",
            "VISUAL-RC1-BINARIES",
        ],
        "current_release_blockers": [
            "MAP-ILLUSTRATED-MASTER",
            "PLAYTEST-RAW-LATEST",
            "COMPONENT-BOM",
        ],
    }
    manifest_path = OUT / "RECOVERY_MANIFEST.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Recovery build OK: {design_count} designs / {len(cards)} physical cards")
    for p in generated + [manifest_path]:
        print(f"- {p.relative_to(ROOT)} {p.stat().st_size} bytes {sha256(p)}")


if __name__ == "__main__":
    main()
