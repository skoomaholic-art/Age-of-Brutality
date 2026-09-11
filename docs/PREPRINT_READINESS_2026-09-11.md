# PREPRINT READINESS — V5.7.2

Дата: 2026-09-11

## Итоговый статус

**PREPRINT SOURCE — PARTIAL / VERIFIED FOR AVAILABLE CANONICAL DATA**

Проект нельзя честно маркировать `PRINT-READY` или `PnP STABLE`: часть физического source отсутствует. При этом карточки, реально присутствующие в текущем MGD, теперь имеют воспроизводимый registry, HTML editor и A4 print source.

## Проверено и готово

| Область | Статус | Факт |
|---|---|---|
| Rules ↔ Data | PASS | `tools/reconcile_v5_7_2.js --check` |
| Card registry | PASS | 111 дизайнов из active MGD |
| Known physical cards | PASS / partial set | 120 экземпляров с учётом `Advisors.Копий=2` |
| HTML Card Editor | PASS | `visual/html_v22/card_editor.html` |
| HTML Print Studio | PASS | A4 3×3; 69×94 мм full; 63×88 мм trim; bleed 3 мм |
| Map topology | PASS | 52 territories / 81 land / 23 sea / 16 ports |
| Print geometry | PASS | соответствует `visual/docs/Print_Guide.md` |

## Карточный состав из текущего canonical source

| Группа | Дизайнов | Физических экземпляров |
|---|---:|---:|
| Events | 30 | 30 |
| Houses | 6 | 6 |
| Characters | 48 | 48 |
| Advisors | 9 | 18 |
| Ambitions | 18 | 18 |
| **Итого** | **111** | **120** |

`Print Studio` разворачивает поле `Копий` автоматически.

## ТРЕБУЕТ РЕШЕНИЯ / ИСХОДНИКА

### 1. Intrigues — HIGH / PRINT BLOCKER

Исторический `V5.7.2-VISUAL-RC1` зафиксировал 160 физических карточек и 5 A4-страниц категории «Интриги». Текущий MGD не содержит sheet `Intrigues`; правила описывают механику, но не полный состав и тексты колоды.

Из текущего source достоверно восстанавливается 120 физических карт. Разница до исторических 160 = **40 карт**.

**Запрещено:** восстанавливать эти 40 карт по памяти или придумывать тексты/характеристики.

### 2. Illustrated map master — HIGH / PRINT BLOCKER

Canonical topology присутствует. Иллюстрированный/печатный master карты в `map/` отсутствует. Топологию менять нельзя.

### 3. Components/BOM — HIGH / PRINT BLOCKER

Полный утверждённый BOM жетонов, маркеров, планшетов, player aids и прочих физических компонентов не мигрирован/не утверждён.

### 4. Certified print package — HIGH

Нет воспроизводимого текущего полного пакета PDF/PNG с утверждёнными backs, cut/bleed QA и контрольной печатью.

### 5. Physical proof — REQUIRED BEFORE PRINT-READY

Нужен реальный тест хотя бы одного A4-листа при 100% масштабе: размеры после печати, bleed, безопасная зона, рез, читаемость, совмещение front/back.

## Не блокирует редактирование карточек

Отсутствие source-matching Arena executable и последних raw playtest logs остаётся блокером цифрового `STABLE`, но не мешает предпечатной верстке карточек из утверждённых MGD данных.

## Автоматические проверки

- `node tools/reconcile_v5_7_2.js --check`
- `node tools/generate_card_registry_v5_7_2.js --check`
- `node tools/check_map_topology_v5_7_2.js`
- `node tools/check_card_html_v5_7_2.js`
- `node tools/audit_card_quantities_v5_7_2.js` — диагностический, фиксирует unresolved 40 Intrigues.
