# Changelog

Все изменения проекта фиксируются в GitHub до выдачи пользовательского билда.

## [V5.7.2-DEV] — Active source line

### Arena RC2

Собран цифровой плейтестовый билд **V5.7.2-PLAYABLE-RC2**.

QA: 500/500 партий завершены на R6, 0 engine errors, 0 invalid actions, 0 prisoner-state invariant errors, 0 unresolved prisoner queues. Targeted: prisoners 9/9, Human UI 6/6, commanders 6/6, nearest-fort land+sea routing 1/1.

### Added

- полный post-capture цикл: отпустить / взять в плен / требовать выкуп N / казнить;
- `heldBy`, captive location, ransom state/history;
- Human prisoner UI;
- Human commander UI;
- AI prisoner scoring/logging;
- AI династические действия, рождения и набеги;
- canonical prisoner/ransom module;
- canonical source graph `data/canonical_manifest_v5.7.2.json`;
- deterministic reconciler `tools/reconcile_v5_7_2.js`;
- RC2 build manifest и Game Master report.

### Changed

- освобождённый и успешно выкупленный персонаж возвращается в столицу своего Дома;
- ближайшая Крепость считается по минимальному числу рёбер канонической карты: land=1, direct sea=1; контроль/армии не учитываются;
- событие «Съезд заложников» является специальным исключением с фиксированным выкупом 2 золота в его раунд;
- исключение события в Arena привязано к названию, а не конфликтующему legacy ID;
- `Айрель` нормализован как canonical House ID в V5.7.2 source;
- prisoner/ransom слой монолитного MGD и основной section 20.2 правил пересобираются из canonical module;
- устаревшие ссылки Rules на V5.7.1 MGD, отсутствующий Cards XLSX и DEV Arena filename включены в deterministic reconciliation.

### Fixed

- captor больше не теряется после пленения;
- смерть больше не хранится как `ПЛЕН`;
- Human response на выкуп не создаёт второй duplicate ransom offer;
- отпускание/выкуп возвращают персонажа в правильную столицу;
- семейные командиры назначаются/двигаются/возвращаются с установленными лимитами;
- AI coverage рождений/набегов/династических союзов больше не нулевое;
- stale prisoner/ransom pending-поля монолитного MGD синхронизированы с canonical module;
- stale section 20.2 основного rule source синхронизирован с canonical prisoner module.

### Open / ТРЕБУЕТ РЕШЕНИЯ

- canonical event-ID «Съезд заложников» / `EV-P06 = Холодная война` требует синхронизации с авторитетным Cards source;
- место содержания при прямом выборе «Взять в плен» без отказа по выкупу не определено отдельным подтверждённым правилом;
- Arena RC2 содержит дополнительный -1 Влияние за казнь во время «Съезда заложников», не подтверждённый доступным каноном;
- Cards/Map binary editable masters ещё не мигрированы в GitHub;
- raw manual `Journal/Diplomacy/Houses` последнего плейтеста не мигрированы в `playtest/`;
- exact RC2 HTML artifact не хранится в GitHub как reconstructable build;
- Components/BOM и print-ready package отсутствуют.

## [V5.7.1] — Historical baseline

Шестираундовая версия, ранее маркированная STABLE. Сохранена как исходная точка диагностики и больше не считается текущим релизом после обнаружения CRITICAL defects.

## [V5.7.0] — Historical QA baseline

Старый 100-seed QA сохранён только как историческое свидетельство и не является regression для V5.7.1/V5.7.2.
