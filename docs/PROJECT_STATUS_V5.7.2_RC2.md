# Project Status Audit — V5.7.2 / Arena RC2

Дата аудита: 2026-09-11.

| Область | В GitHub | Согласовано | Статус |
|---|---|---|---|
| Rules source | Да | В основном | PLAYABLE |
| Prisoner/ransom canonical module | Да | Да | VERIFIED |
| Master Game Data monolith | Да | Нет полностью | REGENERATE |
| Cards master source | Нет | Нет | MISSING SOURCE |
| Map master PNG/SVG/topology | Нет | География зафиксирована | MISSING SOURCE |
| Arena engine/UI source patches | Да | Да | VERIFIED RC2 |
| Arena digital build manifest | Да | Да | VERIFIED RC2 |
| AI behavior | В Arena/MGD | Да для RC2 implementation | PLAYTEST |
| Game Master / QA | Да | Да | 500/500 GREEN |
| Playtest folder | Да | Частично | RAW DATA NEEDS MIGRATION |
| Components/BOM | Нет полного source | Нет | MISSING |
| Print-ready package | Нет | Нет | NOT READY |

## Arena playability

**V5.7.2-PLAYABLE-RC2 является играбельной цифровой версией для плейтеста.**

500-seed regression: 500/500 complete, R6 500/500, 108 actions 500/500, 0 engine errors, 0 invalid, 0 prisoner-state invariant errors, 0 pending prisoner queues.

Targeted: prisoner 9/9; Human prisoner UI 6/6; commanders 6/6; canonical nearest-fort land+sea routing 1/1.

## Что закрыто

- плен и выкуп;
- captor state;
- смерть vs плен;
- возврат отпущенного/выкупленного в столицу владельца;
- canonical nearest-fort routing;
- Human prisoner UI;
- family commanders;
- AI dynastic/birth/raid coverage;
- событие «Съезд заложников» применяется по названию и фиксирует выкуп 2 золота.

## Что не заполнено / отсутствует

1. Полный актуальный Cards source V5.7.2 в `cards/`.
2. Фактические map master files в `map/`.
3. Полный Components/BOM source.
4. Print-ready package.
5. Полностью регенерированный monolithic MGD после последних решений.
6. Canonical event ID для «Съезд заложников» без конфликта с `EV-P06 = Холодная война`.
7. Real-browser visual smoke.

Эти пункты блокируют STABLE/PnP, но не блокируют выдачу Arena RC2 пользователю для цифрового плейтеста.
