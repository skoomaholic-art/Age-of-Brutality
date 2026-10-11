"""Сжимает миниатюры уведомлений и режет лист иконок.
python3 tools/dev/build_notification_art.py <папка с исходниками>
Пишет online/assets/img/notif-<id>.jpg (720 px) и встраивает их в
самостоятельную копию листа: tools/dev/notifications.standalone.html (не в git).
"""
import base64, io, json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'online', 'assets', 'img')
SRC = sys.argv[1]

RENAME = {
    'Когда командир возглавил армию': 'commander_assigned',
    'Когда командир вернулся в королевский двор': 'commander_returned',
    'Когда ты казнил чужого члена семьи': 'execution_done',
    'Когда казнили твоего члена семьи': 'execution_suffered',
    'Когда ты отпустил чужого члена семьи': 'release_done',
    'Когда отпустили твоего члена семьи': 'release_received',
    'Когда игроки успешно договорились о чем то в меню дипломатии': 'deal_made',
    'Когда игроки не сумели договориться в дипломатии': 'deal_failed',
    'Когда смена игрового дня': 'day_change',
}
ICONS = [['day_started', 'recruit_done', 'march_arrived'], ['order_failed', 'player_joined']]

def runs(v, least=40):
    out, start = [], None
    for i, x in enumerate(list(v) + [0]):
        if x and start is None: start = i
        if not x and start is not None:
            if i - start >= least: out.append((start, i))
            start = None
    return out

def write(im, key, width):
    im = im.convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=84, optimize=True, progressive=True)
    name = 'notif-' + key.replace('_', '-') + '.jpg'
    open(os.path.join(OUT, name), 'wb').write(buf.getvalue())
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()

embedded = {}
for f in sorted(os.listdir(SRC)):
    stem, ext = os.path.splitext(f)
    if ext.lower() != '.png': continue
    im = Image.open(os.path.join(SRC, f))
    if stem.startswith('Иконки'):
        alpha = np.asarray(im.convert('RGBA'))[..., 3] > 40
        for (y0, y1), keys in zip(runs(alpha.any(1)), ICONS):
            cols = runs(alpha[y0:y1].any(0))
            assert len(cols) == len(keys), (cols, keys)
            for (x0, x1), key in zip(cols, keys):
                embedded[key] = write(im.crop((x0, y0, x1, y1)), key, 320)
        continue
    key = RENAME.get(stem, stem)
    embedded[key] = write(im, key, 720)

page = open(os.path.join(HERE, 'notifications.html'), encoding='utf-8').read()
marker = 'const EMBEDDED = {};'
assert marker in page
page = page.replace(marker, 'const EMBEDDED = ' + json.dumps(embedded) + ';')
open(os.path.join(HERE, 'notifications.standalone.html'), 'w', encoding='utf-8').write(page)
print(len(embedded), 'images:', ' '.join(sorted(embedded)))
