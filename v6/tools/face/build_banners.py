"""Вырезает гербы и готовые штандарты из листа-конструктора.
python3 tools/face/build_banners.py -> online/assets/img/banner-emblem-N.png, banner-ready-N.png
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', '..', 'online', 'assets', 'img')
px = np.asarray(Image.open(os.path.join(HERE, 'sheet-constructor.png')).convert('RGB')).astype(np.float32)

# гербы: всё, что отличается от пергамента
x0, y0, x1, y1 = 818, 436, 1262, 712
reg = px[y0:y1, x0:x1]
bg = np.median(reg.reshape(-1, 3), axis=0)
fg = ndimage.binary_opening(np.abs(reg - bg).sum(-1) > 70, iterations=1)
lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=2))
boxes = []
for ys, xs in ndimage.find_objects(lab):
    if (xs.stop - xs.start) * (ys.stop - ys.start) >= 500: boxes.append((xs.start, ys.start, xs.stop, ys.stop))
boxes.sort(key=lambda b: (round((b[1] + b[3]) / 2 / 55), b[0]))
for i, (a, b, c, e) in enumerate(boxes, 1):
    m = ndimage.binary_fill_holes(ndimage.binary_closing(fg[b:e, a:c], iterations=2))
    rgba = np.dstack([reg[b:e, a:c], m * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    side = max(im.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0)); sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    sq.resize((120, 120), Image.LANCZOS).save(os.path.join(IMG, f'banner-emblem-{i}.png'), optimize=True)

# готовые штандарты: десять плашек вместе с пергаментом под ними
poles = [9, 85, 153, 214, 285, 354, 424, 493, 562, 632, 716]
for i in range(10):
    tile = px[870:1010, 818 + poles[i] - 6:818 + poles[i + 1] - 8].astype(np.uint8)
    im = Image.fromarray(tile, 'RGB')
    im.resize((im.width * 2, im.height * 2), Image.LANCZOS).save(os.path.join(IMG, f'banner-ready-{i + 1}.png'), optimize=True)
print(len(boxes), 'emblems, 10 ready standards')
