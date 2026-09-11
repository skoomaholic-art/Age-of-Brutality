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
- RC2 build manifest и Game Master report.

### Changed

- освобождённый и успешно выкупленный персонаж возвращается в столицу своего Дома;
- ближайшая Крепость считается по минимальному числу рёбер канонической карты: land=1, direct sea=1; контроль/армии не учитываются;
- событие «Съезд заложников» является специальным исключением с фиксированным выкупом 2 золота в его раунд;
- исключение события в Arena привязано к названию, а не конфликтующему legacy ID;
- `Айрель` нормализован как canonical House ID в V5.7.2 source.

### Fixed

- captor больше не теряется после пленения;
- смерть больше не хранится как `ПЛЕН`;
- Human response на выкуп не создаёт второй duplicate ransom offer;
- отпускание/выкуп возвращают персонажа в правильную столицу;
- семейные командиры назначаются/двигаются/возвращаются с установленными лимитами;
- AI coverage рождений/набегов/династических союзов больше не нулевое.

### Open

- монолитный MGD требует полной регенерации из canonical modules;
- event registry «Съезд заложников» / `EV-P06 = Холодная война` требует синхронизации ID;
- Cards/Map binary editable masters ещё не мигрированы в GitHub;
- Components/BOM и print-ready package отсутствуют;
- real-browser visual smoke остаётся пользовательским/браузерным gate.

## [V5.7.1] — Historical baseline

Шестираундовая версия, ранее маркированная STABLE. Сохранена как исходная точка диагностики и больше не считается текущим релизом после обнаружения CRITICAL defects.

## [V5.7.0] — Historical QA baseline

Старый 100-seed QA сохранён только как историческое свидетельство и не является regression для V5.7.1/V5.7.2.
