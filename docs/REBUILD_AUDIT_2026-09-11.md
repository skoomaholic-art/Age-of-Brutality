# Rebuild Audit — 2026-09-11

> **Historical snapshot.** Не использовать как текущий release verdict: после
> этого аудита появились source-matching current DEV Arena, human diplomacy
> consent и полный размер армии в Марше.

Рабочая линия: **V5.7.2-DEV**.

## Итог

Аудит прошёл по цепочке:

`RULES → DATA → CARDS → MAP → ARENA → AI → QA → PLAYTEST → VISUAL/PRINT`

Внутренние игровые рассинхроны, которые можно было подтвердить текущими материалами, закрыты. Оставшиеся blockers — это отсутствующие исходники/артефакты, а не места, заполненные догадками.

## Закрытые рассинхроны

### Rules / prisoners

§20.2 основного rules source генерируется из `rules/source/02d_prisoners_ransom.md`.

Зафиксировано:

- release / hold / ransom N / execute;
- direct hold и ransom reject используют единый detention rule;
- release/paid ransom возвращают персонажа в owner capital;
- execution = 1 action / -3 Influence;
- death и captive state взаимоисключающие;
- Human `N` — положительное целое, без фиксированного верхнего диапазона.

### Event registry

`EV-P06 = «Съезд заложников»` в V5.7.2. Эффект события: ransom = 2 gold in current round. Событие не меняет execution price. Legacy `EV-P06 = «Холодная война»` признан stale inherited baseline и заменён reconciler-ом.

### Master Game Data

Prisoner/ransom/event rows регенерированы по canonical module. `tools/reconcile_v5_7_2.js --check` валидирует consistency.

### Cards

Добавлен `cards/canonical_registry_v5.7.2.json`, генерируемый verbatim из активного MGD: 96 объектов / 48 CARD_ID. Это закрывает отсутствие машинного gameplay registry, но не заменяет print layout/art master.

### Map

Добавлен canonical topology JSON: 52 территории / 81 land edges / 23 sea edges / 16 ports. География, порты и маршруты не изменялись.

### Arena source

RC2 delta source синхронизирован с canonical event/prisoner rules и strict ransom N validation.

## Почему новый Arena executable не выпущен

Попытка воспроизводимой сборки специально была остановлена после проверки исходников. `arena/source/rc1/*.b64` распаковывается лишь частично: recovered HTML содержит `ARENA_DATA`, но заканчивается до `class ArenaEngine` и до `</body>`. В Git history отсутствует недостающий tail.

Поэтому новый RC из этого материала был бы подделкой. Временный RC3 build workflow/patch был удалён; никакой RC3 не объявлен.

Исторический RC2 QA 500/500 остаётся свидетельством старого executable, но не подтверждает post-rebuild source fixes.

## Открытые внешние/source blockers

1. Complete Arena baseline/HTML.
2. Physical card layout/art master.
3. Illustrated map PNG/SVG master.
4. Latest manual Journal/Diplomacy/Houses raw JSON.
5. Visual V2/V2.1 full executable/generator/generated pack.
6. Components/BOM.
7. Reproducible print-ready package.
8. Standalone normalized AI config (не блокирует механическую consistency, но остаётся repo hygiene debt).

## Release verdict

- Rules/Data/card-registry/map-topology source consistency: **RECONCILED**.
- Arena source corrections: **APPLIED**.
- Current source-matching executable: **BLOCKED BY MISSING COMPLETE BASELINE**.
- Physical STABLE/PnP: **BLOCKED BY MISSING PHYSICAL/VISUAL SOURCES**.

Ни один отсутствующий файл не был заменён выдуманным содержимым.
