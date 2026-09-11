# HTML Card Editor / Print Studio V2.2

Версия: `V5.7.2-HTML-CARDS-V2.2`.

Это воспроизводимый source для предпечатной работы с карточками из текущего canonical registry.

## Файлы

- `index.html` — вход в комплект;
- `card_editor.html` — редактор данных/изображения карточки;
- `print_studio.html` — A4 print layout 3×3.

## Источник данных

`../../cards/canonical_registry_v5.7.2.json`.

Оба HTML принимают canonical registry через file picker. При запуске через локальный HTTP server редактор также умеет загрузить registry по относительному пути.

## Печатная геометрия

- trim: **63×88 мм**;
- bleed: **3 мм**;
- full card: **69×94 мм**;
- raster art target: **300 dpi**;
- A4: **9 карт (3×3)**;
- печать: 100%, без `Fit to page`.

## Правило данных

Gameplay-поля в Card Editor заблокированы по умолчанию. Их можно разблокировать для проектной правки, но такая правка не становится канонической автоматически: после неё требуется синхронизация с `data/master_game_data_v5.7.2-dev.json`, rules и регенерация `cards/canonical_registry_v5.7.2.json`.

Визуальные параметры (`accent`, изображение, fit, X/Y) сохраняются в Project JSON и не изменяют canonical gameplay registry.

Принцип: `STATIC ART / ART_SLOT -> HTML TEXT/DATA -> PRINT`.
