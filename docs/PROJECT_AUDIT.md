# PROJECT AUDIT — «Жестокий Век»

**Рабочая линия:** V5.7.2-DEV  
**Дата аудита:** 2026-09-11  
**Source of truth:** `skoomaholic-art/zhestokiy-vek`

## Вердикт инвентаризации

V5.7.1-STABLE больше не считается релизом, прошедшим release gates. Это исторический baseline, на котором Game Master выявил критические дефекты. Текущая разработка переведена в V5.7.2-DEV.

Главная инфраструктурная проблема: в репозитории зафиксированы manifest, hashes и QA, но канонические игровые Office/HTML/Map-артефакты V5.7.1 физически не представлены как полноценные редактируемые sources; большинство каталогов содержат только README. До миграции source-файлов утверждение «GitHub = master» выполнено не полностью.

## Инвентаризация

| Источник | Версия | Статус | Канонический? | Конфликтует с | Требуемое действие |
|---|---|---|---|---|---|
| `VERSION` | V5.7.2-DEV | active development | ДА | старый статус STABLE | вести DEV до прохождения gates |
| Rules DOCX из release manifest | V5.7.1 | historical baseline; бинарник не является редактируемым repo-source | НЕТ | новое решение по плену; пропущенный развод; Айрель без полного текста Дома | импортировать/нормализовать в repo-source, затем синхронизировать |
| Master Game Data XLSX | V5.7.1 | historical baseline | НЕТ | `Айрельь` vs `Айрель`; фиксированный ransom=3; нет полного post-capture action model | нормализовать master data |
| Cards XLSX | V5.7.1 | historical baseline | НЕТ | House card Айреля без полного эффекта/слабости | синхронизировать с MGD |
| Card Templates XLSX | V5.7.1 | historical baseline | НЕТ | зависит от обновлённых Cards/Data | регенерировать после card audit |
| Bot Config XLSX | V5.7.1 | historical baseline | НЕТ | нет prisoner decision flow; профили смешаны с House balance | вынести в канонический AI config и покрыть тестами |
| Arena HTML | V5.7.1 | executable baseline | НЕТ | плен без владельца/процедуры; смерть кодируется как `ПЛЕН`; семейные командиры неполны; AI не выбирает династический союз; слабость Айреля отсутствует | исправить в V5.7.2-DEV |
| Final illustrated map | V5.7.1 | visual baseline | УСЛОВНО | должна сверяться с canonical topology | сохранить географию; подготовить print master |
| Canonical topology JSON | filename V5.7.1, internal V5.6.6 | data metadata error | НЕТ до исправления | собственное поле version | исправить metadata без изменения топологии |
| Game Master Rule Auditor | v1 | active QA tool | ДА | выявил CRITICAL в V5.7.1 | расширить validators и regression coverage |
| Game Master report 100 seeds | V5.7.1 | diagnostic evidence | ДА как исторический QA | не проходит release gate из-за CRITICAL/coverage gaps | сохранить неизменным; новый QA только после fixes |
| Baseline V5.7.0 QA | V5.7.0 | historical evidence | НЕТ для текущего релиза | не является V5.7.1/5.7.2 regression | хранить отдельно |
| Experimental 30 VP / RULE_PENDING branch | experimental | deprecated/excluded | НЕТ | стабильная 6-round линия | не смешивать без отдельного решения |

## Подтверждённые фактические рассинхроны

### DATA_ERROR — HOUSE-ID-001
В MGD Дом записан как `Айрельь`, тогда как Rules, Cards, Characters и Arena используют `Айрель`. Из-за несовпадения ключа в таблице Домов rulebook у Айреля уже выпали способность/слабость. Нормализовать ключ до `Айрель` во всех источниках.

### DATA_ERROR — MAP-VERSION-001
Файл топологии с именем V5.7.1 содержит внутреннее поле `version: V5.6.6`. Топологические наборы MGD и JSON совпадают; менять географию не требуется. Исправить только метаданные версии после контрольной сверки.

### ARENA_ERROR — PRISON-001
Плен реально возникает, но post-capture procedure не реализована полностью. Утверждённые варианты победителя: `Отпустить пленника`, `Взять в плен`, `Требовать выкуп N`, `Казнить`.

### STATE_CORRUPTION — PRISON-002
При пленении state не хранит захвативший Дом (`heldBy/captorHouse`).

### STATE_CORRUPTION — DEATH-001
Arena кодирует смерть как `alive=false` одновременно с `mode="ПЛЕН"`, хотя MGD различает статусы `ПЛЕН` и `Мёртв`.

### RULES_ERROR — RANSOM-001
Старые Rules/MGD используют фиксированный выкуп 3 золота, но последнее подтверждённое решение — `Требовать выкуп N`. Старое число больше не является каноническим общим правилом.

### RULES_ERROR — DIVORCE-001
`Развод` существует в MGD Actions и Arena, а также упоминается в эффекте советника, но отдельная полная процедура в основном rulebook отсутствует.

### ARENA/AI_ERROR — DYNASTY-001
Действие династического союза технически существует, но AI `chooseAction` не добавляет его в набор выбираемых действий. Нулевая частота династических союзов в 100-seed прогоне имеет техническую причину, а не должна объясняться «решением ИИ».

### ARENA_ERROR — COMMANDER-001
Командирская модель фактически завязана на текущего правителя/один `commanderLocation`, тогда как система персонажей требует согласованного использования членов семьи и последствий боя для них.

### COVERAGE_RISK — DEAD-MECH-001
В 100-seed прогоне: raids=0, births=0, dynastic alliances=0. Для каждой механики требуется определить конкретную причину: availability, weight, prerequisite, state или implementation.

## Release gates на старте V5.7.2-DEV

| Gate | Статус | Причина |
|---|---|---|
| 1 — Rules | FAIL | плен/ransom конфликт; развод неполон; Айрель потерял данные |
| 2 — Data | FAIL | House key typo; prisoner model/ransom conflict; topology metadata |
| 3 — Cards | FAIL | House card Айреля неполон; требуется полный card audit после data normalization |
| 4 — Map | PARTIAL | topology sets совпадают, но version metadata неверна; print master не сертифицирован |
| 5 — Arena | FAIL | подтверждённые CRITICAL state/implementation defects |
| 6 — AI | FAIL | prisoner flow отсутствует; dynastic action unreachable; profile/House confound |
| 7 — Game Master | FAIL | V5.7.1 report содержит 3 CRITICAL |
| 8 — Playtest | FAIL | 100/100 структурно завершены, но rules-completeness/coverage gate не пройден |
| 9 — Coverage | FAIL | плен не разрешается; три ключевые механики имеют 0 coverage |
| 10 — Print | NOT STARTED | нет сертифицированного print package |
| 11 — Rulebook | FAIL | не полностью self-contained для всех существующих actions |
| 12 — Components | NOT STARTED | точный BOM ещё не утверждён/не собран |

## Приоритет исправлений

1. Мигрировать канонические редактируемые source-данные в GitHub.
2. Нормализовать идентификаторы Домов, начиная с `Айрельь` → `Айрель`.
3. Реализовать полный prisoner state + post-capture procedure.
4. Развести `Мёртв` и `ПЛЕН` в state-machine.
5. Синхронизировать семейных командиров Rules ↔ Data ↔ Cards ↔ Arena ↔ AI.
6. Починить AI path для династического союза; расследовать 0 births и 0 raids.
7. Закрыть неполные rules procedures (`Развод` и связанные edge cases).
8. Повторить 100-seed regression с Game Master, затем rotating-profile matrix.
9. Только после gameplay gates переходить к окончательному prepress/print package.

## ТРЕБУЕТ РЕШЕНИЯ

### RANSOM-N-001
Последнее решение задаёт действие `Требовать выкуп N`, но допустимый диапазон/правило выбора N пока не определены. До отдельного решения запрещено молча возвращать фиксированные 3 золота или вводить скрытый cap.

Этот пункт не блокирует остальные независимые исправления.
