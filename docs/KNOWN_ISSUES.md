# Known Issues — V5.7.2-DEV

Дата сверки: 2026-09-13.

Здесь перечислены только подтверждённые проблемы текущей линии. Исторические отсутствующие RC-файлы не считаются блокерами current Arena.

## Открытые проблемы

| ID | Severity | Область | Проблема | Что закрывает |
|---|---|---|---|---|
| ARENA-BROWSER-001 | MEDIUM | Arena/UI | Current standalone build не прошёл зафиксированный real-browser smoke основных human flows | Browser matrix + smoke record |
| CARD-PREPRESS-001 | HIGH | Cards/Print | 151/160 card data полны, но нет сертифицированного единого 160-card PDF с финальными backs/art | Prepress build + physical proof |
| MAP-ART-001 | HIGH | Map/Print | Digital topology SVG работает; прежний PNG повреждён, утверждённого editable illustrated master нет | Approved art source + print proof |
| COMPONENTS-001 | HIGH | Components | Нет полного утверждённого BOM и всех editable production masters | BOM + source files + quantities |
| PLAYTEST-RAW-001 | MEDIUM | Playtest | Нет свежего полного ручного Journal/Diplomacy/Houses набора | Recorded manual session |
| PRINT-001 | HIGH | Release | Нет воспроизводимого сертифицированного print-ready package | Все physical blockers + proof |

## Закрыто текущим cleanup

- Current Arena строится из tracked source и имеет собственный manifest/hash.
- Все 18 записей MGD представлены: 16 обычных действий и 2 свободные процедуры.
- `sourceBlockedActions` пуст.
- 40 Интриг закреплены отдельным canonical new-design module; полный набор теперь 151/160.
- Морской Марш разрешён только из контролируемого порта по непосредственному printed sea edge.
- Семейные командиры покрыты назначением, возвратом, лимитами и движением с армией.
- Покрыты release, hold, ransom validation/accept/reject, execute и succession.
- Current Game Master regression проходит 100/500 seeds без engine/legality ошибок.
- Digital Arena больше не встраивает повреждённый PNG: карта строится как stateful SVG из canonical topology.
- `Новая партия` имеет явный feedback и запускает следующий seed, если поле seed не изменено вручную.
- Legacy recovery/diagnostic workflows больше не запускаются на каждый push.

## Исторические записи

Exact RC2 HTML и Visual RC1 binaries по-прежнему физически отсутствуют. Их hashes сохранены для provenance, но current source-matching Arena и новый explicit Intrigue module заменяют их как рабочие зависимости. Это не означает, что исторические файлы были «восстановлены».

## Правило закрытия

`FIX → SOURCE SYNC → STATIC CHECK → BUILD → INVARIANTS → REGRESSION → BROWSER/PHYSICAL PROOF → COMMIT`
