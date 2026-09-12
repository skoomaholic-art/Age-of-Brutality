# Жестокий Век — CURRENT PROJECT STATE

Дата сверки: 2026-09-12
Версия: `V5.7.2-DEV`
Статус релиза: **DEVELOPMENT / NOT STABLE**
MASTER: GitHub `main`

Этот документ — текущая точка входа для статуса проекта. Он собран после сверки доступной истории проекта, актуальных Rules/Data/Cards/Map/AI, Arena recovery, QA и открытых GitHub Issues. Старые RC-отчёты считаются историческими свидетельствами, а не доказательством текущего source.

## 1. Что уже собрано и согласовано

### RULES

- Основной корпус V5.7.2-DEV присутствует в `rules/source/`.
- Партия: ровно 6 раундов, 3 действия Дома за раунд.
- Победа и tie-break определены.
- Влияние не имеет утверждённого верхнего лимита 15.
- Дипломатия разделяет Официальный Пакт, Право прохода и Династический союз.
- Определены война, бой, рейд, крепости, экономика, персонажи, наследование, регентство, плен и казнь.
- Текущие правила плена синхронизированы с `data/prisoners_v5.7.2-dev.json`.

### MASTER GAME DATA

`data/master_game_data_v5.7.2-dev.json` является активным MGD.

Подтверждено:

- 18 action rows;
- 6 Домов;
- 48 персонажей;
- 9 дизайнов Советников / 18 физических экземпляров;
- 18 Амбиций;
- 30 Событий;
- AI target weights / plans / escalation / diplomacy / naval-center blocks;
- canonical land/sea/port data.

### CARDS

`cards/canonical_registry_v5.7.2.json` восстановлен из текущих подтверждённых данных.

Текущий подтверждённый физический набор: **120 карт**:

- Events — 30;
- Houses — 6;
- Characters — 48;
- Advisors — 18 физических экземпляров;
- Ambitions — 18.

Print Studio/card editor и генерация recovery PDF существуют.

### MAP

`map/canonical_topology_v5.7.2.json` — текущий технический master topology:

- 52 территории;
- 81 сухопутная связь;
- 23 морских маршрута;
- 16 портов.

### AI

Собраны:

- 6 House Agents;
- Prisoner Agent;
- MultiAgentCoordinator;
- `ai/config/canonical_v5.7.2.json`;
- deterministic unit/config checks.

AI-политика: агент выбирает только из переданных движком `LEGAL_ACTIONS`; решение должно иметь score/reason log.

### QA / GAME MASTER

- Game Master runner присутствует.
- Исторический `V5.7.2-PLAYABLE-RC2` прошёл 500/500 seeds до R6 без engine errors / invalid actions / prisoner invariant failures.
- Это **historical evidence**, потому что current source после RC2 изменялся.

## 2. Главный текущий блокер — P0 Arena

Issue: `#9 P0 Arena: восстановить повреждённый RC3 source bootstrap и запускаемый executable`.

Факты диагностики:

- `arena/source/current/rc3_source_bundle.tgz.b64` повреждён буквальной вставкой `[...] ELLIPSIZATION ...`;
- recovered engine prefix собран из частей и имеет размер 33,592 bytes;
- `node --check` recovered prefix падает с `Unexpected end of input`;
- runtime обрывается внутри `resolvePrisonerDecision`;
- отсутствует закрытие полного engine/IIFE и current source-matching executable;
- поэтому текущая Arena **не может считаться воспроизводимым executable V5.7.2**.

### Что требуется для закрытия P0

1. Сформировать полный tracked Arena source из подтверждённых частей и канонических правил, не выдавая реконструкцию за старый RC3.
2. Довести engine runtime до синтаксически и функционально полного состояния.
3. Восстановить/создать воспроизводимый build standalone Arena из source.
4. Добавить decode/checksum/syntax/smoke проверки в CI.
5. Получить зелёный `Playable Arena` workflow.

## 3. P1 — LEGAL_ACTIONS не покрывают Master Game Data

Issue: `#10 P1 Engine: синхронизировать LEGAL_ACTIONS с Master Game Data V5.7.2`.

MGD содержит 18 действий/процедур. Проверенный recovered engine prefix фактически генерирует/resolves только 10 основных типов:

- March;
- Recruit;
- Fort;
- Adviser;
- Neutral Marriage;
- Birth;
- Pact;
- Dynastic Marriage;
- Access;
- Raid.

В полной цепочке текущего recovered runtime не доказаны:

- Draw Intrigue;
- Active Intrigue;
- Legitimization;
- Divorce;
- Investigation;
- Return from Exile;
- Break Pact;
- Gold Transfer.

`Break Pact` и `Gold Transfer` по правилам являются свободными процедурами и не должны ошибочно съедать один из трёх action slots.

### Критерий закрытия

Для каждой строки MGD должна существовать проверяемая цепочка:

`MGD → LEGAL_ACTION generator → validator → resolver → state mutation → Journal → UI → AI availability`.

Если действие заблокировано отсутствующим source, это должно быть явно записано, а не молча исчезать из игры.

## 4. BLOCKER DATA — 40 карт Интриг

Issue: `#11 BLOCKER Data: найти канонический источник 40 карт Интриг V5.7.2`.

Факты:

- исторический Visual pack содержал 160 физических карт;
- текущий canonical source подтверждает 120;
- MGD не содержит полного `Intrigues` sheet;
- правила ссылаются на исторический источник `03_Жестокий_Век_Карточки_V5.7.2-DEV.xlsx`, которого в текущем репозитории нет;
- точные тексты, цели, стоимости, ограничения и copy count 40 Интриг не могут быть восстановлены без источника.

**Запрещено:** придумывать эти 40 карт и выдавать за прежний канон.

Статус: `ТРЕБУЕТ РЕШЕНИЯ / SOURCE MIGRATION`.

## 5. Семейные командиры и плен — правила есть, implementation proof нет

Issues: `#2` и `#3`.

Текущие правила уже определяют:

- взрослых здоровых персонажей в армии;
- максимум 1 командира на армию и 2 персонажей Дома в армиях;
- судьбу командира;
- 4 post-capture решения: release / hold / ransom N / execute;
- detention location;
- возврат после release/ransom;
- смерть и плен как разные состояния;
- наследование/регентство.

Но эти цепочки должны быть доказаны на новом source-matching Arena executable:

`назначение → марш → бой → судьба → плен/смерть → решение пленителя → освобождение/казнь → наследование/регентство → Journal`.

## 6. Свежий regression пока невозможен

Issue: `#1 QA: провести reproducible regression для V5.7.2 после восстановления RC3`.

Пока P0 Arena открыт, нельзя честно объявлять текущую игру прошедшей 100/500-seed regression.

После восстановления executable требуется:

1. smoke;
2. минимум 100 reproducible seeds;
3. затем 500+ seeds;
4. естественное завершение после R6;
5. 108 action slots для полной 6-House партии, если правила не создали законных пропусков/резервов, с отдельной проверкой причин;
6. 0 engine errors;
7. 0 invalid actions;
8. 0 invariant failures;
9. динамика VP / Influence / territories / wars / gold;
10. Diplomacy / Access / Pact / Dynastic / prisoners / commanders / succession coverage;
11. win-rate Домов и анализ AI decision-making;
12. raw Journal / Houses / Diplomacy / Game Master outputs в репозитории.

## 7. Физический комплект — ещё не production-ready

### Карточки

- 120 подтверждённых карт генерируются.
- 40 Интриг отсутствуют как canonical source.
- Финальные иллюстрации/backs/full art-master не собраны как воспроизводимый утверждённый пакет.

### Карта

- Техническая topology актуальна.
- Финальный иллюстрированный PNG/SVG print master не мигрирован.
- Визуальная стилизация не имеет права менять topology/порты/маршруты/границы.

### Жетоны и компоненты

- Есть частичные guides/templates.
- Нет окончательного утверждённого BOM: полный список компонентов, количества, размеры, стороны, source и print master каждого типа.

### Print/PnP

- Полного сертифицированного current-source PnP package и physical proof нет.

## 8. Playtest raw-data gap

`playtest/` не содержит полного актуального набора последних ручных:

- Journal JSON;
- Diplomacy JSON;
- Houses JSON;
- всех связанных raw exports.

Исторические отчёты полезны для root-cause анализа, но не заменяют свежий regression нового candidate.

## 9. Исправленная система доставки

Текущий release package должен пересобираться при изменениях canonical проектных областей, а не только при редактировании самого workflow.

Workflow `.github/workflows/current-delivery-package.yml` является механизмом упаковки текущего `main` в единый artifact. Его trigger должен отслеживать Rules/Data/Cards/Map/Arena/AI/QA/Visual/Components/Docs/Release/tools и release metadata.

## 10. Критический путь до STABLE

Порядок работ:

1. **P0 ARENA** — полный tracked engine + reproducible executable.
2. **P1 ACTION PARITY** — все 18 MGD action/procedure chains.
3. **COMMANDERS / PRISONERS / SUCCESSION / DIPLOMACY** — end-to-end tests.
4. **INTRIGUE SOURCE** — найти исходные 40 карт или вынести новый дизайн на отдельное решение пользователя.
5. **100-seed current regression**.
6. Исправить выявленные RULES / DATA / ARENA / AI / LOGGING проблемы.
7. **500+ seed balance regression**.
8. Анализ баланса: VP pace, Influence, economy, wars, relations, ambitions, House win-rate.
9. Финальные card/map/token/component masters + BOM.
10. Physical print smoke/PnP proof.
11. Финальная consistency проверка всей цепочки.
12. Только после этого тег/версия `STABLE`.

## 11. Definition of STABLE

Версию нельзя считать STABLE, пока одновременно не выполнено:

- Rules согласованы;
- MGD согласован;
- Cards полностью определены;
- Map технически и физически определена;
- Arena строится из tracked source;
- все 18 действий исполняемы/валидируются либо имеют официальное решение о блокировке;
- AI использует только legal engine actions;
- Game Master regression свежий и воспроизводимый;
- партия стабильно завершается по правилам;
- отсутствуют P0/P1 consistency issues;
- physical component BOM утверждён;
- PnP package воспроизводим из repository source.

## 12. Текущий итог

**Игровые правила и canonical data уже существенно восстановлены. Главный затык проекта сейчас — не дизайн правил, а потерянный/повреждённый Arena baseline и отсутствие доказанной реализации всего утверждённого корпуса в одном воспроизводимом executable.**

Второй независимый блокер — **40 канонических карт Интриг**, которые нельзя законно восстановить без исходника или нового решения пользователя.

После закрытия этих двух направлений можно наконец проводить свежий полноценный балансировочный плейтест, а не анализировать исторические executable.