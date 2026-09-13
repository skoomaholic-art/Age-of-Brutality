# Жестокий Век — Visual Print & Play

Текущая зафиксированная линия визуала: **V5.7.2-VISUAL-RC1 + HTML Visual Editor V2.2**. Она относится к физическому PnP-контуру и сверяется с Arena **V5.7.2-PLAYABLE-CURRENT-DEV**; visual/print source остаётся неполным.

Это в первую очередь физическая настольная игра. Arena остаётся вспомогательным инструментом для плейтестов и QA.

## Что фактически хранится в GitHub

- `docs/` — style guide, print guide, physical-playability audit, QA и manifest ранее собранных visual artifacts;
- `templates/` — editable SVG-шаблоны карточек;
- `arena/tabletop_visual_rc1.css` — tabletop skin;
- `html_v2/README.md` и `html_v21/README.md` — описание локальных HTML visual builds;
- `map/README.md` — описание и SHA ранее собранной styled map.

## Что в GitHub сейчас отсутствует

В текущем дереве репозитория **нет**:

- `visual/build/` и генератора полного visual pack;
- самого standalone HTML Visual Editor V2/V2.1;
- styled map SVG/PDF/PNG;
- 160 card PNG/PDF и full-pack PDF;
- `Жестокий_Век_Visual_Print_and_Play_Pack.zip`;
- `Жестокий_Век_Arena_Styled.html`.

Их ранее собранные имена, размеры и SHA-256 зафиксированы в `docs/Repo_Release_Manifest.json`, а результаты проверки — в `docs/Visual_Pack_QA.md`. Это подтверждает существование проверенного локального/generated RC artifact, но **не делает текущий GitHub воспроизводимым visual/print source**.

## HTML Visual Editor V2.2 — зафиксированный принцип

Фоновые изображения не должны содержать игровой текст. Названия, ID, числа, характеристики и правила выводятся HTML-слоем.

Standalone HTML по зафиксированному дизайну должен работать без внешних ассетов: фон и рабочая копия SVG-иконок встраиваются внутрь файла. Отдельные SVG остаются печатными/редакторскими ассетами.

У карточек предусмотрено HTML-редактирование текста и собственного изображения; карта использует отдельные HTML-подписи, перемещение которых не должно менять topology. Карта рассчитана на печать целиком и сегментами **4×3 = 12 листов A4**. Динамические состояния персонажей отмечаются внешними жетонами.

## Статус воспроизводимости

- Исторический/generated Visual RC1: **QA RECORDED**.
- GitHub visual sources: **PARTIAL**.
- Reproducible visual build из одного только GitHub: **НЕТ**.
- STABLE/PnP: **НЕТ**.

До миграции generator/source/artifacts визуальная линия остаётся source-migration debt. Нельзя считать отсутствующие файлы восстановленными по одному manifest или по памяти.
