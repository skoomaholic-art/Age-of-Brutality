"""Режет листы пресетов на детали портрета.
python3 tools/face/build_faces.py  ->  online/assets/img/face-<вид>-<n>.png + online/assets/map/faces.json
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', '..', 'online', 'assets', 'img')
OUT_JSON = os.path.join(HERE, '..', '..', 'online', 'assets', 'map', 'faces.json')

# вид: (файл, раскладка, масштаб к холсту портрета 400 px)
#   'grid c r' — c колонок, r строк; 'blobs d' — связные пятна после расширения на d px
SHEETS = {
    'head':   ('heads',   'blobs 4',   1.0),
    'eyes':   ('eyes',    'grid 2 5',  0.34),
    'brows':  ('brows',   'grid 2 5',  0.33),
    'nose':   ('noses',   'blobs 6',   0.24),
    'mouth':  ('mouths',  'blobs 6',   0.34),
    'beard':  ('beards',  'blobs 3',  0.62),
    'hair':   ('hair',    'blobs 1',  0.86),
    'hat':    ('hats',    'blobs 2',  0.70),
    'clothes':('clothes', 'grid 2 5',  0.78),
}

def clean(im):
    px = np.asarray(im.convert('RGBA')).copy()
    a = px[..., 3].astype(np.int32)
    # полупрозрачная кайма вокруг деталей — мусор вырезки
    a = np.where(a < 150, 0, a)
    px[..., 3] = a.astype(np.uint8)
    return px

def boxes_blobs(alpha, grow):
    mask = ndimage.binary_dilation(alpha > 0, iterations=grow)
    lab, n = ndimage.label(mask)
    out = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl
        if (alpha[sl] > 0).sum() < 900: continue
        out.append((xs.start, ys.start, xs.stop, ys.stop))
    # по строкам, затем слева направо
    out.sort(key=lambda b: (round(((b[1] + b[3]) / 2) / 150), b[0]))
    return out

def runs(v, least):
    out, start = [], None
    for i, x in enumerate(list(v) + [0]):
        if x and start is None: start = i
        if not x and start is not None:
            if i - start >= least: out.append((start, i))
            start = None
    return out

def boxes_grid(alpha, cols, rows):
    h, w = alpha.shape
    out = []
    for c in range(cols):
        x0, x1 = w * c // cols, w * (c + 1) // cols
        part = alpha[:, x0:x1] > 0
        bands = runs(part.sum(1) > 6, 30)
        # склеиваем лишние полосы, пока не останется rows
        while len(bands) > rows:
            gaps = [bands[i + 1][0] - bands[i][1] for i in range(len(bands) - 1)]
            i = int(np.argmin(gaps)); bands[i:i + 2] = [(bands[i][0], bands[i + 1][1])]
        for y0, y1 in bands:
            xs = np.where(part[y0:y1].any(0))[0]
            out.append((x0 + xs.min(), y0, x0 + xs.max() + 1, y1, c))
    out.sort(key=lambda b: (round(((b[1] + b[3]) / 2) / 120), b[4]))
    return [b[:4] for b in out]

def main():
    manifest = {}
    for kind, (name, layout, scale) in SHEETS.items():
        px = clean(Image.open(os.path.join(HERE, name + '.png')))
        alpha = px[..., 3]
        parts = layout.split()
        boxes = boxes_blobs(alpha, int(parts[1])) if parts[0] == 'blobs' else boxes_grid(alpha, int(parts[1]), int(parts[2]))
        manifest[kind] = []
        for i, (x0, y0, x1, y1) in enumerate(boxes, 1):
            cut = px[y0:y1, x0:x1].copy()
            # стираем отдельные соринки вокруг детали
            lab, n = ndimage.label(cut[..., 3] > 0)
            if n > 1:
                sizes = ndimage.sum(cut[..., 3] > 0, lab, range(1, n + 1))
                for k, size in enumerate(sizes, 1):
                    if size < max(400, sizes.max() * 0.02): cut[lab == k] = 0
            im = Image.fromarray(cut, 'RGBA')
            w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
            # файл вдвое крупнее, чем на холсте: портрет бывает увеличен
            im = im.resize((w * 2, h * 2), Image.LANCZOS).quantize(160, method=2)
            file = f'face-{kind}-{i}.png'
            im.save(os.path.join(IMG, file), optimize=True)
            manifest[kind].append({'w': w, 'h': h})
    json.dump(manifest, open(OUT_JSON, 'w'))
    print({k: len(v) for k, v in manifest.items()})

if __name__ == '__main__':
    main()
