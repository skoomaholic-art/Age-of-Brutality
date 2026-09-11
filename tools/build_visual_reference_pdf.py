#!/usr/bin/env python3
import base64
import io
import re
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "references" / "visual_style"
OUT = SRC / "Жестокий_Век_Референсы_оформления.pdf"
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def extract_image(svg_path: Path):
    text = svg_path.read_text(encoding="utf-8")
    match = re.search(r"base64,([^\"']+)", text)
    if not match:
        raise RuntimeError(f"No embedded raster image in {svg_path}")
    raw = base64.b64decode(match.group(1))
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return image


def image_reader(image: Image.Image):
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    return ImageReader(buf)


def main():
    refs = [extract_image(SRC / f"{i:02}.svg") for i in range(1, 19)]
    pdfmetrics.registerFont(TTFont("JV", str(FONT)))
    pdfmetrics.registerFont(TTFont("JVB", str(BOLD)))
    width, height = landscape(A4)
    c = canvas.Canvas(str(OUT), pagesize=(width, height), pageCompression=1)
    c.setTitle("Жестокий Век — Референсы оформления")
    c.setAuthor("Жестокий Век")

    c.setFont("JVB", 24)
    c.drawString(36, height - 42, "ЖЕСТОКИЙ ВЕК — РЕФЕРЕНСЫ ОФОРМЛЕНИЯ")
    c.setFont("JV", 10)
    c.drawString(36, height - 62, "18 визуальных референсов художественного направления проекта")
    cols, rows = 6, 3
    left, right, top, bottom = 36, 36, 88, 38
    cell_w = (width - left - right) / cols
    cell_h = (height - top - bottom) / rows
    for idx, image in enumerate(refs):
        col, row = idx % cols, idx // cols
        x0 = left + col * cell_w
        y0 = height - top - (row + 1) * cell_h
        max_w, max_h = cell_w - 10, cell_h - 27
        iw, ih = image.size
        scale = min(max_w / iw, max_h / ih)
        dw, dh = iw * scale, ih * scale
        c.drawImage(image_reader(image), x0 + (cell_w - dw) / 2, y0 + 21 + (max_h - dh) / 2, dw, dh)
        c.setFont("JVB", 8)
        c.drawCentredString(x0 + cell_w / 2, y0 + 7, f"{idx + 1:02}")
    c.showPage()

    slot_h = (height - 90) / 2
    for idx in range(0, 18, 2):
        c.setFont("JVB", 20)
        c.drawString(36, height - 36, f"Референсы {idx + 1:02}–{idx + 2:02}")
        c.setFont("JV", 8)
        c.drawRightString(width - 36, height - 33, "Жестокий Век • визуальная база")
        for j in range(2):
            n = idx + j + 1
            image = refs[n - 1]
            iw, ih = image.size
            y_top = height - 60 - j * slot_h
            y_bottom = y_top - slot_h + 12
            c.rect(36, y_bottom, width - 72, slot_h - 16, stroke=1, fill=0)
            c.setFont("JVB", 13)
            c.drawString(46, y_top - 26, f"{n:02}")
            max_w, max_h = width - 230, slot_h - 52
            scale = min(max_w / iw, max_h / ih)
            dw, dh = iw * scale, ih * scale
            c.drawImage(image_reader(image), 160, y_bottom + 22 + (max_h - dh) / 2, dw, dh)
        c.showPage()

    c.save()
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
