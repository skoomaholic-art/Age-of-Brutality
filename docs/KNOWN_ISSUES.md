# Known Issues — V5.7.2-DEV

Дата сверки: 2026-09-13.

Здесь перечислены только подтверждённые проблемы текущей линии. Исторические отсутствующие RC-файлы не считаются блокерами current Arena.

## Открытые проблемы

| ID | Severity | Область | Проблема | Что закрывает |
|---|---|---|---|---|
| ARENA-BROWSER-001 | MEDIUM | Arena/UI | Current standalone build не прошёл зафиксированный real-browser smoke основных human flows | Browser matrix + smoke record |
| PLAYERCOUNT-001 | HIGH | Rules/Arena | Rules разрешают 3–6 Домов, а current Arena/Game Master запускают фиксированные 6 Домов; процедура вывода неучаствующих Домов не утверждена | Отдельное подтверждённое правило setup для 3/4/5 Домов + player-count smoke |
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
- Марш показывает все законные размеры армии и отклоняет перегруз территории сверх лимита 8.
- Дипломатическое предложение человеческому Дому теперь блокирует партию до явного «Принять/Отклонить»; до принятия действие и ресурсы не списываются.
- Digital Arena больше не встраивает повреждённый PNG: карта строится как stateful SVG из canonical topology.
- `Новая партия` имеет явный feedback и запускает следующий seed, если поле seed не изменено вручную.
- Legacy recovery/diagnostic workflows больше не запускаются на каждый push.

## Исторические записи

Exact RC2 HTML и Visual RC1 binaries по-прежнему физически отсутствуют. Их hashes сохранены для provenance, но current source-matching Arena и новый explicit Intrigue module заменяют их как рабочие зависимости. Это не означает, что исторические файлы были «восстановлены».

## Правило закрытия

`FIX → SOURCE SYNC → STATIC CHECK → BUILD → INVARIANTS → REGRESSION → BROWSER/PHYSICAL PROOF → COMMIT`

## Нужное решение по 3–5 Домам

Это не следует закрывать догадкой. Для физического режима на 3/4/5 Домов
нужно явно выбрать процедуру: какие Дома участвуют, что происходит с их
столицами/картами/доходом и как меняются цели победы. До такого решения
current digital DEV и его Game Master честно считаются six-House reference
run; остальные варианты остаются открытым rule-design gate.
