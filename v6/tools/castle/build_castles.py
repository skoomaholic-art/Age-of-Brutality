"""Перекрашивает флаги столичных замков в цвета Домов.
Запуск: python3 tools/castle/build_castles.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'online', 'assets', 'img')
SIZE = 256
HOUSES = {
    'varkair': (0xb3, 0x31, 0x1f), 'sairven': (0x2c, 0x4a, 0x86), 'ortain': (0x2e, 0x28, 0x26),
    'erkai': (0x3f, 0x70, 0x48), 'tasvar': (0xc0, 0x58, 0x7a), 'airel': (0x6a, 0x45, 0x85),
}
ASH = (0x8d, 0x8a, 0x82)

def load(name):
    return np.asarray(Image.open(os.path.join(HERE, name)).convert('RGBA')).astype(np.float32)

def soften(mask, r=1.2):
    im = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im).astype(np.float32) / 255

def tint(px, mask, colour, ref, kmax=1.9):
    """Заменяет цвет под маской, сохраняя светотень (яркость относительно ref)."""
    lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    k = np.clip(lum / ref, 0.12, kmax)[..., None]
    c = np.array(colour, dtype=np.float32)
    # тёмные цвета Домов чуть осветляем, чтобы складки ткани читались
    base = c + (255 - c) * 0.10
    new = np.clip(base * k, 0, 255)
    out = px.copy()
    out[..., :3] = px[..., :3] * (1 - mask[..., None]) + new * mask[..., None]
    return out

def save(px, name, size=SIZE):
    im = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), 'RGBA')
    im = im.crop(im.getbbox())
    side = max(im.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, side - im.height))
    sq.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

def poly_mask(shape, pts):
    m = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return np.asarray(m) > 0

def crimson_mask(px):
    r, g, b, a = [px[..., i] for i in range(4)]
    return (a > 40) & (r > 110) & (g / np.maximum(r, 1) < 0.34) & (r > b + 40)

def main():
    intact = load('capital-intact.png')
    m = soften(crimson_mask(intact).astype(np.float32))
    lum = intact[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    ref = float(np.median(lum[m > 0.6]))
    for key, col in HOUSES.items():
        save(tint(intact, m, col, ref), f'capital-{key}.png')

    cap = load('capital-captured.png')
    zone = poly_mask(cap.shape, FLAG_CAPTURED)
    lum = cap[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    dark = zone & (cap[..., 3] > 40) & (lum < 95)
    m = soften(dark.astype(np.float32))
    ref = float(np.median(lum[dark]))
    for key, col in HOUSES.items():
        save(tint(cap, m, col, max(ref, 70.0), 1.25), f'capital-captured-{key}.png')

    ab = load('capital-abandoned.png')
    r, b = ab[..., 0], ab[..., 2]
    yy, xx = np.mgrid[0:ab.shape[0], 0:ab.shape[1]]
    flag = (yy < 340) & (xx > 600) & (ab[..., 3] > 40) & (r > 105) & (r > b + 35)
    m = soften((crimson_mask(ab) | flag).astype(np.float32))
    lum = ab[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    save(tint(ab, m, ASH, float(np.median(lum[m > 0.6])), 1.3), 'capital-abandoned.png')

    for name in ('city', 'city-abandoned'):
        px = load(name + '.png')
        px[..., 3] = np.where(px[..., 3] < 24, 0, px[..., 3])  # stray near-transparent specks
        save(px, name + '.png', 200)

FLAG_CAPTURED = [(668, 40), (1100, 40), (1100, 340), (840, 340), (820, 250), (668, 245)]

if __name__ == '__main__':
    main()
