# Rebuild Audit — 2026-09-11

Рабочая линия: **V5.7.2-DEV**  
Играбельная Arena: **V5.7.2-PLAYABLE-RC2**

## Итог

Цифровая Arena RC2 остаётся пригодной для плейтеста: последний Game Master regression завершил 500/500 партий на R6 без engine errors, invalid actions, prisoner-state invariant errors и незакрытых prisoner queues.

Полный статус **STABLE/PnP** пока запрещён: репозиторий не содержит всех авторитетных физических source-файлов и exact RC2 HTML artifact, а monolithic MGD содержит унаследованные тексты, уже заменённые каноническим prisoner module.

## Подтверждённые рассинхроны

### RULES_SOURCE — stale 20.2 / stale README

`rules/source/02_diplomacy_dynasty_characters.md` содержит старый текст 20.2, где сумма/принятие выкупа и возврат ещё помечены как нерешённые. Канонический `02d_prisoners_ransom.md` уже содержит подтверждённую процедуру.

`rules/source/README.md` также ошибочно называл возврат и nearest-fort нерешёнными.

Действие: канонический модуль оставлен приоритетным; добавлен deterministic reconcile tool, README синхронизирован.

### DATA — stale prisoner fields in monolithic MGD

`master_game_data_v5.7.2-dev.json` всё ещё содержит `ТРЕБУЕТ РЕШЕНИЯ` в prisoner/ransom полях, хотя `prisoners_v5.7.2-dev.json` и подтверждённое решение 2026-09-11 уже определяют процедуру.

Действие: добавлены `canonical_manifest_v5.7.2.json` и `tools/reconcile_v5_7_2.js`. Скрипт переносит подтверждённые prisoner facts в дублируемые поля MGD и синхронизирует section 20.2, не назначая новых игровых чисел.

### DATA/CARDS — EVENT-ID-001

В текущем MGD `EV-P06 = «Холодная война»`. Событие «Съезд заложников» имеет подтверждённый эффект выкупа 2 золота, но не имеет синхронизированного canonical `CARD_ID`.

Действие: конфликт остаётся открытым. Новый ID не придуман. RC2 продолжает связывать исключение по названию события.

### ARENA/RULES — direct «Взять в плен» routing

Arena RC2 source вызывает `detainPrisoner(...)` и для прямого выбора `hold`, и после отказа от выкупа. Для **отказа** маршрут nearest captor fort → captor capital подтверждён. Для прямого **«Взять в плен»** такой маршрут в подтверждённом решении отдельно не зафиксирован.

Действие: не канонизировать поведение по аналогии; зарегистрировать `PRISON-HOLD-001` как `ТРЕБУЕТ РЕШЕНИЯ`.

### ARENA/CARDS — дополнительная цена казни при «Съезде заложников»

В `v5.7.2_rc2_engine_delta.js` при активном «Съезде заложников» казнь дополнительно вызывает `adjustInfluence(captor,-1,...)`. Доступный канонический prisoner rule подтверждает для события только фиксированный выкуп **2 золота**.

Действие: зарегистрировать `EVENT-EXEC-001`. Не удалять и не объявлять этот -1 правилом до сверки с авторитетным card source; current Cards master отсутствует в GitHub.

### PLAYTEST — raw manual logs not migrated

Автоматизированные QA отчёты есть, но в `playtest/` нет полного актуального набора ручных `Journal / Diplomacy / Houses` JSON.

Действие: обновлена политика `playtest/README.md`; ручной аудит нельзя считать полным без raw-пакета.

### REPO/ARENA — exact build artifact missing

RC2 manifest фиксирует имя, размер и SHA-256 HTML, а source patches/QA присутствуют, но exact HTML не хранится в репозитории как полный reconstructable artifact.

Статус: OPEN. Нельзя объявлять репозиторий полностью самодостаточным executable master.

### CARDS / MAP / COMPONENTS / PRINT

Полный editable Cards source, master Map files в `map/`, полный BOM и сертифицированный print-ready package отсутствуют либо не мигрированы в канонические каталоги.

Статус: OPEN; эти долги блокируют STABLE/PnP.

## Не менять без отдельного решения

- географию, границы, порты и морские маршруты;
- `EV-P06 = «Холодная война»` путём самовольного переименования;
- переговорный характер Human↔Human выкупа;
- подтверждённые 4 post-capture options;
- утверждённый special effect «Съезда заложников»: 2 золота в его раунд;
- игровые числа, которых нет в авторитетных источниках.

## Release verdict

- Digital Arena playtest: **PLAYABLE RC2**
- Rules/Data source consistency: **PARTIAL / RECONCILIATION ADDED**
- Manual playtest evidence: **RAW DATA MISSING IN REPO**
- Physical STABLE/PnP: **BLOCKED**
