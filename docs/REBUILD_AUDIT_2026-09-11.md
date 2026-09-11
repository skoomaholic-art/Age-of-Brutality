# Rebuild Audit — 2026-09-11

Рабочая линия: **V5.7.2-DEV**  
Играбельная Arena: **V5.7.2-PLAYABLE-RC2**

## Итог

Цифровая Arena RC2 остаётся пригодной для плейтеста: зафиксированный Game Master regression завершил 500/500 партий на R6 без engine errors, invalid actions, prisoner-state invariant errors и незакрытых prisoner queues.

В ходе repo-wide аудита найдены и исправлены stale prisoner/ransom данные и stale rule entrypoints. Монолитный MGD и основной section 20.2 теперь фактически пересобраны из canonical prisoner module; deterministic reconciliation проходит повторно без смысловых изменений.

Полный статус **STABLE/PnP** по-прежнему запрещён. Репозиторий не содержит всех авторитетных Cards/Map/Components/Print sources, полного raw manual playtest package, exact RC2 HTML и полного воспроизводимого Visual RC1 build source. Кроме того, остаются открытые cross-source вопросы Arena/Cards/Rules.

## Что было исправлено

### RULES — stale 20.2 и устаревшие точки входа

До пересборки `rules/source/02_diplomacy_dynasty_characters.md` содержал старый 20.2, где уже подтверждённые ransom/release решения ещё выглядели нерешёнными. `rules/source/README.md` также называл часть подтверждённых prisoner rules pending, а верхний `rules/README.md` ошибочно объявлял V5.7.1 STABLE DOCX каноническим текущим источником.

Исправлено:

- `02d_prisoners_ransom.md` закреплён как canonical module;
- основной section 20.2 регенерируется из него;
- сохранена подтверждённая казнь: 1 действие / -3 Влияния;
- negotiated Human↔Human `N`, release destination и reject routing синхронизированы;
- устаревшие ссылки на V5.7.1 как текущий master, отсутствующий Cards XLSX и несуществующий DEV Arena filename заменены на фактический V5.7.2 source graph.

### DATA — stale prisoner fields in monolithic MGD

До пересборки `master_game_data_v5.7.2-dev.json` содержал унаследованные `ТРЕБУЕТ РЕШЕНИЯ` в ransom/release полях, хотя canonical module и решение 2026-09-11 уже определяли процедуру.

Исправлено:

- добавлен `data/canonical_manifest_v5.7.2.json`;
- добавлен `tools/reconcile_v5_7_2.js`;
- монолитный MGD фактически пересобран;
- `RANSOM` = 0 действий + `N` золота;
- `EXECUTION` = 1 действие / -3 Влияния;
- prisoner state schema и release destination синхронизированы;
- unresolved места не заполнены предположениями.

## Подтверждённые открытые расхождения

### DATA/CARDS — EVENT-ID-001

В текущем MGD `EV-P06 = «Холодная война»`. Событие «Съезд заложников» имеет подтверждённый эффект выкупа **2 золота**, но не имеет синхронизированного canonical `CARD_ID`.

Действие: конфликт остаётся открытым. Новый ID не придуман. RC2 связывает исключение по названию события.

### RULES/DATA/ARENA — PRISON-HOLD-001

Arena RC2 вызывает `detainPrisoner(...)` и для прямого выбора `hold`, и после отказа от выкупа. Для **отказа** маршрут nearest captor fort → captor capital подтверждён. Для прямого **«Взять в плен»** место содержания отдельным подтверждённым правилом не определено.

Действие: implementation behavior не канонизирован по аналогии. Пункт остаётся `ТРЕБУЕТ РЕШЕНИЯ`.

### RULES/CARDS/ARENA — EVENT-EXEC-001

В `v5.7.2_rc2_engine_delta.js` при активном «Съезде заложников» казнь дополнительно вызывает `adjustInfluence(captor,-1,...)`. Доступный канон подтверждает для события только фиксированный выкуп **2 золота**.

Действие: дополнительный `-1` не объявлен правилом и не удалён из исторически QA-проверенного RC2 source. Нужна сверка с авторитетным Cards source или отдельное решение перед следующим Arena rebuild.

### PLAYTEST/LOGGING — raw manual logs not migrated

Автоматизированные QA отчёты есть, но в `playtest/` нет полного актуального набора ручных `Journal / Diplomacy / Houses` JSON.

Действие: `playtest/README.md` теперь требует raw-пакет, build SHA, seed и режим партии. Без него нельзя считать аудит Human-плейтеста полным.

### REPO/ARENA — exact build artifact missing

RC2 manifest фиксирует имя, размер и SHA-256 HTML, source patches/QA присутствуют, но exact HTML не хранится в репозитории как полный reconstructable artifact.

Статус: OPEN. Текущий historical QA относится к зафиксированному artifact; его нельзя честно объявить заново прогнанным из одного GitHub checkout.

### VISUAL/REPO — recorded RC, но не воспроизводимый GitHub source

Visual RC1 manifest и QA фиксируют ранее собранный 50.9 MB visual ZIP, styled Arena, styled map, 160 individual card PDFs и full-pack PDF. Однако в текущем дереве GitHub:

- нет `visual/build/`;
- нет standalone HTML Visual V2/V2.1;
- `visual/map/` содержит только README;
- generated card/map/ZIP artifacts отсутствуют.

Действие: hashes/QA сохранены как evidence ранее собранного RC, но `repository_reproducible=false`. Это source/artifact migration debt, а не основание объявлять исторический visual QA недействительным.

### AI source normalization

Текущая AI-логика распределена между MGD и Arena patches; отдельного нормализованного canonical AI config/source нет.

Статус: OPEN как source-maintenance debt. Это не отменяет подтверждённое ненулевое coverage AI в RC2.

### CARDS / MAP / COMPONENTS / PRINT

Полный editable Cards source, master Map files в canonical `map/`, полный BOM и сертифицированный print-ready package отсутствуют или не мигрированы.

Статус: OPEN; эти долги блокируют STABLE/PnP.

## Не менять без отдельного решения

- географию, границы, порты и морские маршруты;
- `EV-P06 = «Холодная война»` путём самовольного переименования;
- переговорный характер Human↔Human выкупа;
- подтверждённые 4 post-capture options;
- special effect «Съезда заложников»: 2 золота в его раунд;
- игровые числа, которых нет в авторитетных источниках;
- Arena-only поведение нельзя автоматически повышать до физического правила.

## Release verdict

- Digital Arena playtest: **PLAYABLE RC2**
- Prisoner Rules/Data reconciliation: **DONE**
- Overall Rules/Data/Cards/Map/Arena alignment: **PARTIAL / OPEN ISSUES REMAIN**
- Manual playtest evidence: **RAW DATA MISSING IN REPO**
- Visual repository reproducibility: **BLOCKED**
- Physical STABLE/PnP: **BLOCKED**
