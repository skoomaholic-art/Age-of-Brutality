"""Builds the display font "Vek Gothic" from the alphabet sheet next to this file.

    pip install numpy scipy scikit-image pillow fonttools brotli
    python3 tools/font/build_font.py tools/font/alphabet-sheet.png \
        /tmp/vek-gothic.ttf online/assets/fonts/vek-gothic.woff2 "Vek Gothic"

Each letter is cut out of the sheet, cleaned, traced to outlines and placed
on a common baseline. The sheet has letters only, so the font has no digits or
punctuation: pages fall back to their text face for those.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SRC, OUT_TTF, OUT_WOFF2, FAMILY = sys.argv[1:5]

# Row bands on the sheet (top, bottom) and the letters each one holds, left to right.
ROWS = [
    ('latin', 'upper', 176, 292, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    ('latin', 'lower', 298, 426, 'abcdefghijklmnopqrstuvwxyz'),
    ('cyrillic', 'upper', 600, 714, 'АБВГДЕЁЖЗИЙКЛМНОПРСТУ'),
    ('cyrillic', 'upper', 724, 826, 'ФХЦЧШЩЪЫЬЭЮЯ'),
    ('cyrillic', 'lower', 842, 948, 'абвгдеёжзийклмнопрсту'),
    ('cyrillic', 'lower', 950, 1040, 'фхцчшщъыьэюя'),
]
UPM = 1000
CAP_HEIGHT = 700
SIDE_BEARING = 40
UPSCALE = 6

gray = np.array(Image.open(SRC).convert('L')).astype(np.float32)


def row_letters(y0, y1, expected):
    """Returns one boolean mask per letter (row-sized) with its bounding box."""
    region = gray[y0:y1]
    mask = ndi.binary_closing(region < 128, structure=np.ones((3, 3)))
    labels, _ = ndi.label(mask, structure=np.ones((3, 3)))
    comps = []
    for index, sl in enumerate(ndi.find_objects(labels)):
        width = sl[1].stop - sl[1].start
        area = int((labels[sl] == index + 1).sum())
        if area < 14 or width > 200:
            continue
        if sl[1].start < 30 or sl[1].stop > gray.shape[1] - 30:
            continue
        comps.append({'ids': [index + 1], 'x0': sl[1].start, 'x1': sl[1].stop,
                      'y0': sl[0].start, 'y1': sl[0].stop, 'area': area})
    comps.sort(key=lambda c: c['x0'])

    def join(a, b):
        a['ids'] += b['ids']
        a['x0'] = min(a['x0'], b['x0']); a['x1'] = max(a['x1'], b['x1'])
        a['y0'] = min(a['y0'], b['y0']); a['y1'] = max(a['y1'], b['y1'])
        a['area'] += b['area']

    # Dots and breves join the letter they sit over; neighbours whose swashes
    # merely overlap stay apart.
    letters = []
    for comp in comps:
        if letters:
            last = letters[-1]
            overlap = min(last['x1'], comp['x1']) - max(last['x0'], comp['x0'])
            if overlap >= 0.55 * min(last['x1'] - last['x0'], comp['x1'] - comp['x0']):
                join(last, comp)
                continue
        letters.append(comp)
    heights = sorted(l['y1'] - l['y0'] for l in letters)
    typical = heights[len(heights) // 2]
    letters = [l for l in letters if (l['y1'] - l['y0']) > 0.45 * typical and l['area'] > 120]
    # Ы is two strokes side by side.
    for target in 'Ыы':
        if target in expected and len(letters) == len(expected) + 1:
            i = expected.index(target)
            join(letters[i], letters[i + 1])
            del letters[i + 1]
    if len(letters) != len(expected):
        raise SystemExit(f'row {expected[:6]}…: expected {len(expected)} letters, found {len(letters)}')
    for letter in letters:
        letter['mask'] = np.isin(labels, letter['ids'])
    return letters


def outline(mask):
    """Traces a letter mask into closed polylines in upscaled pixel units."""
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = mask[y0:y1, x0:x1]
    # The ink is mottled: fill the pinholes, keep real counters.
    holes = ndi.label(~crop)[0]
    for index, sl in enumerate(ndi.find_objects(holes)):
        hole = holes[sl] == index + 1
        touches_edge = sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == crop.shape[0] or sl[1].stop == crop.shape[1]
        if not touches_edge and hole.sum() < 10:
            crop[sl][hole] = True
    pad = 3
    field = np.pad(crop.astype(np.float32), pad)
    big = np.array(Image.fromarray((field * 255).astype(np.uint8)).resize(
        (field.shape[1] * UPSCALE, field.shape[0] * UPSCALE), Image.BICUBIC)).astype(np.float32) / 255
    big = ndi.gaussian_filter(big, 2.6)
    rings = []
    for contour in measure.find_contours(big, 0.5):
        if len(contour) < 12:
            continue
        simple = measure.approximate_polygon(contour, tolerance=1.1)
        if len(simple) < 4:
            continue
        # (row, col) in padded upscaled pixels -> (x, y) in sheet pixels * UPSCALE
        pts = [(c - pad * UPSCALE + x0 * UPSCALE, r - pad * UPSCALE + y0 * UPSCALE) for r, c in simple[:-1]]
        rings.append(pts)
    return rings


def signed_area(points):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(points, points[1:] + points[:1])) / 2


def inside(point, ring):
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


glyphs = {}
advances = {}
drawn = {}
stem_center = 0
for script in ('latin', 'cyrillic'):
    rows = [(case, y0, y1, chars, row_letters(y0, y1, chars)) for s, case, y0, y1, chars in ROWS if s == script]
    cap_px = float(np.median([l['y1'] - l['y0'] for case, *_, letters in rows if case == 'upper' for l in letters]))
    scale = CAP_HEIGHT / cap_px / UPSCALE
    for case, y0, y1, chars, letters in rows:
        baseline = float(np.median([l['y1'] for l in letters])) + y0
        for char, letter in zip(chars, letters):
            rings = outline(letter['mask'])
            left = min(p[0] for ring in rings for p in ring)
            right = max(p[0] for ring in rings for p in ring)
            shaped = []
            for ring in rings:
                depth = sum(1 for other in rings if other is not ring and inside(ring[0], other))
                # font space: x right, y up, origin on the baseline
                pts = [((x - left) * scale, (baseline * UPSCALE - (y + y0 * UPSCALE)) * scale) for x, y in ring]
                shaped.append((pts, depth % 2 == 1))
            drawn[char] = (shaped, (right - left) * scale)
            if char == 'г':
                # Centre of the stem: the longest run of columns inked nearly top to bottom.
                cols = np.where(letter['mask'].any(axis=0))[0]
                box = letter['mask'][:, cols[0]:cols[-1] + 1]
                tall = box.sum(axis=0) > 0.75 * box.sum(axis=0).max()
                best, run_start = (0, 0), None
                for i, flag in enumerate(list(tall) + [False]):
                    if flag and run_start is None:
                        run_start = i
                    if not flag and run_start is not None:
                        if i - run_start > best[1] - best[0]:
                            best = (run_start, i)
                        run_start = None
                stem_center = ((cols[0] + (best[0] + best[1]) / 2) * UPSCALE - left) * scale
    print(script, 'cap height', round(cap_px, 1), 'px')

# On the sheet the small т is the cursive three-stem form and looks the same as
# the small м, so «дом» and «дот» read alike. The upright т is built from the
# small г and its mirror image about the stem: one stem under a bar that
# reaches both ways, with the weight and height of the other small letters.
g_rings, g_width = drawn['г']
t_rings = list(g_rings) + [([(2 * stem_center - x, y) for x, y in pts], hole) for pts, hole in g_rings]
t_left = min(x for pts, _ in t_rings for x, _ in pts)
t_right = max(x for pts, _ in t_rings for x, _ in pts)
drawn['т'] = ([([(x - t_left, y) for x, y in pts], hole) for pts, hole in t_rings], t_right - t_left)

for char, (shaped, width) in drawn.items():
    pen = TTGlyphPen(None)
    for pts, hole in shaped:
        pts = [(x + SIDE_BEARING, y) for x, y in pts]
        clockwise = signed_area(pts) < 0
        # TrueType: outer contours clockwise, holes the other way
        if clockwise == hole:
            pts.reverse()
        pen.moveTo((round(pts[0][0]), round(pts[0][1])))
        for x, y in pts[1:]:
            pen.lineTo((round(x), round(y)))
        pen.closePath()
    glyphs[char] = pen.glyph()
    advances[char] = round(width + 2 * SIDE_BEARING)

names = {char: 'uni%04X' % ord(char) for char in glyphs}
order = ['.notdef', 'space'] + [names[c] for c in glyphs]
empty = TTGlyphPen(None).glyph()
box = TTGlyphPen(None)
for ring in ([(60, 0), (60, 700), (440, 700), (440, 0)], [(110, 50), (390, 50), (390, 650), (110, 650)]):
    box.moveTo(ring[0])
    for point in ring[1:]:
        box.lineTo(point)
    box.closePath()

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap({32: 'space', 0xA0: 'space', **{ord(c): names[c] for c in glyphs}})
fb.setupGlyf({'.notdef': box.glyph(), 'space': empty, **{names[c]: g for c, g in glyphs.items()}})
metrics = {'.notdef': (500, 60), 'space': (250, 0)}
glyf = fb.font['glyf']
for char in glyphs:
    glyph = glyf[names[char]]
    glyph.recalcBounds(glyf)
    metrics[names[char]] = (advances[char], glyph.xMin)
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=900, descent=-300)
fb.setupNameTable({'familyName': FAMILY, 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=900, sTypoDescender=-300, usWinAscent=950, usWinDescent=320,
            sCapHeight=CAP_HEIGHT, sxHeight=470)
fb.setupPost()
fb.save(OUT_TTF)

font = TTFont(OUT_TTF)
font.flavor = 'woff2'
font.save(OUT_WOFF2)
import os
print(len(glyphs), 'letters;', os.path.getsize(OUT_TTF) // 1024, 'KB ttf,', os.path.getsize(OUT_WOFF2) // 1024, 'KB woff2')
