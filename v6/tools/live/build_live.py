"""Режет листы на детали живых голов: online/assets/img/live-*.png
python3 tools/live/build_live.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', '..', 'online', 'assets', 'img')

def load(name):
    px = np.asarray(Image.open(os.path.join(HERE, name)).convert('RGBA')).copy()
    px[..., 3] = np.where(px[..., 3] < 110, 0, px[..., 3])
    return px

def blobs(px, band, grow=2, least=500):
    m = np.zeros(px.shape[:2], bool); m[band[0]:band[1]] = px[band[0]:band[1], :, 3] > 0
    lab, _ = ndimage.label(ndimage.binary_dilation(m, iterations=grow))
    out = [(xs.start, ys.start, xs.stop, ys.stop) for ys, xs in ndimage.find_objects(lab) if m[ys, xs].sum() > least]
    return sorted(out)

def save(px, box, name, canvas=None, scale=1.0):
    im = Image.fromarray(px[box[1]:box[3], box[0]:box[2]], 'RGBA')
    if canvas:
        sheet = Image.new('RGBA', canvas, (0, 0, 0, 0))
        sheet.paste(im, ((canvas[0] - im.width) // 2, (canvas[1] - im.height) // 2))
        im = sheet
    if scale != 1: im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.save(os.path.join(IMG, name), optimize=True)

faces = load('faces.png')
HEADS = [(8, 0, 252, 345), (252, 40, 462, 345), (462, 40, 690, 345), (690, 40, 950, 345), (950, 40, 1180, 345), (1180, 40, 1440, 345)]
for i, b in enumerate(HEADS, 1):
    cut = faces[b[1]:b[3], b[0]:b[2]].copy()
    # соседние головы касаются друг друга: оставляем самое большое пятно
    lab, n = ndimage.label(cut[..., 3] > 0)
    if n > 1:
        sizes = ndimage.sum(cut[..., 3] > 0, lab, range(1, n + 1)); cut[lab != (int(np.argmax(sizes)) + 1)] = 0
    im = Image.fromarray(cut, 'RGBA'); im = im.crop(im.getbbox())
    sheet = Image.new('RGBA', (270, 350), (0, 0, 0, 0)); sheet.paste(im, ((270 - im.width) // 2, 350 - im.height))
    sheet.save(os.path.join(IMG, f'live-head-{i}.png'), optimize=True)
n = 0
for band in [(365, 445), (447, 525)]:
    row = blobs(faces, band)
    for k in range(0, 12, 2):
        n += 1; a, b = row[k], row[k + 1]
        save(faces, (a[0], min(a[1], b[1]), b[2], max(a[3], b[3])), f'live-eyes-{n}.png', (220, 84))
n = 0
for band in [(530, 585), (588, 642)]:
    row = blobs(faces, band)
    for k in range(0, 12, 2):
        n += 1; a, b = row[k], row[k + 1]
        save(faces, (a[0], min(a[1], b[1]), b[2], max(a[3], b[3])), f'live-brows-{n}.png', (270, 60))
n = 0
for band in [(645, 715), (718, 795)]:
    for b in blobs(faces, band):
        n += 1; save(faces, b, f'live-mouth-{n}.png', (120, 84))
parts = load('parts.png')
for i, b in enumerate(blobs(parts, (265, 565), 2, 4000), 1):
    cut = parts[b[1]:b[3], b[0]:b[2]].copy()
    lab, n = ndimage.label(cut[..., 3] > 0)
    if n > 1:
        sizes = ndimage.sum(cut[..., 3] > 0, lab, range(1, n + 1)); cut[lab != (int(np.argmax(sizes)) + 1)] = 0
    im = Image.fromarray(cut, 'RGBA'); im.crop(im.getbbox()).save(os.path.join(IMG, f'live-hand-{i}.png'), optimize=True)
print('done')

# воины без лиц для линзы
squad = load('squad.png')
SOLDIERS = [((480, 336, 790, 1075), (623, 544, 667, 589)), ((790, 262, 1160, 1075), (953, 532, 996, 581)), ((1145, 368, 1440, 1070), (1232, 545, 1278, 590))]
for i, (b, f) in enumerate(SOLDIERS, 1):
    cut = squad[b[1]:b[3], b[0]:b[2]].copy()
    lab, n = ndimage.label(cut[..., 3] > 0)
    if n > 1:
        sizes = ndimage.sum(cut[..., 3] > 0, lab, range(1, n + 1)); cut[lab != (int(np.argmax(sizes)) + 1)] = 0
    im = Image.fromarray(cut, 'RGBA'); box = im.getbbox(); im = im.crop(box)
    fx, fy = f[0] - b[0] - box[0], f[1] - b[1] - box[1]
    print('soldier', i, im.size, 'face %', round(fx / im.width * 100, 1), round(fy / im.height * 100, 1), round((f[2] - f[0]) / im.width * 100, 1), round((f[3] - f[1]) / im.height * 100, 1))
    im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(os.path.join(IMG, f'live-soldier-{i}.png'), optimize=True)
