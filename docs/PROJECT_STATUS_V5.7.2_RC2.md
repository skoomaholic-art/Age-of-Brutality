# Project Status Audit — V5.7.2 / Arena RC2

Дата аудита: 2026-09-11.

| Область | В GitHub | Согласовано | Статус |
|---|---|---|---|
| Rules source | Да | Prisoner layer пересобран; остаются открытые решения | PLAYABLE / DEV |
| Prisoner/ransom canonical module | Да | Да, кроме явно отмеченных pending | VERIFIED + PENDING ITEMS |
| Master Game Data monolith | Да | Prisoner/ransom layer синхронизирован | RECONCILED / CROSS-SOURCE AUDIT CONTINUES |
| Cards master source | Нет | Нет | MISSING SOURCE |
| Map master PNG/SVG/topology | Нет в canonical `map/` | География зафиксирована | MISSING SOURCE |
| Arena engine/UI source patches | Да | Да для RC2 implementation; найдены 2 rule discrepancies | PLAYABLE RC2 / AUDIT OPEN |
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

Это подтверждает структурную играбельность RC2, но не доказывает отсутствие rule/data discrepancies, которые не покрыты конкретным QA assertion.

## Что закрыто / пересобрано

- prisoner/ransom слой монолитного MGD;
- stale section 20.2 основного rules source;
- переговорный Human↔Human выкуп N;
- captor state;
- смерть vs плен;
- возврат отпущенного/выкупленного в столицу владельца;
- canonical nearest-fort routing после отказа от выкупа;
- подтверждённая цена казни 1 действие / -3 Влияния сохранена в canonical module и MGD;
- Human prisoner UI;
- family commanders;
- AI dynastic/birth/raid coverage;
- событие «Съезд заложников» применяется в RC2 по названию и фиксирует выкуп 2 золота.

## ТРЕБУЕТ РЕШЕНИЯ / МИГРАЦИИ

1. Canonical `CARD_ID` для «Съезда заложников» без конфликта с `EV-P06 = Холодная война`.
2. Место содержания при прямом выборе «Взять в плен» без отказа по выкупу. Arena RC2 вызывает `detainPrisoner(...)`, но отдельное физическое правило не подтверждено.
3. Дополнительный `-1 Влияние` за казнь во время «Съезда заложников» в Arena RC2: подтвердить по авторитетному Cards source или убрать в будущем rebuild Arena.
4. Полный актуальный Cards source V5.7.2 в `cards/`.
5. Фактические map master files в canonical `map/`.
6. Полный текущий raw manual playtest package `Journal/Diplomacy/Houses`.
7. Exact RC2 HTML artifact/reconstructable build в GitHub.
8. Полный Components/BOM source и сертифицированный print-ready package.

Эти пункты блокируют STABLE/PnP. Пункты 2–3 также требуют закрытия перед тем, как считать RC2 полностью согласованной реализацией физических правил.
