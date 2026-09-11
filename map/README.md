# Map

## Current status

Каноническая география проекта остаётся **Final Illustrated V5.7.1 topology**. Географию, границы, порты и морские маршруты нельзя менять без отдельного решения проекта.

Historical master references:

- PNG SHA-256: `c9acf198c807b38fc1a3354dfedd80d5d149575726d38274e0c047e27eedcfda`
- SVG SHA-256: `ade55bf3f7d774fe86de321243370a073640a90966a9c38d3c3fb58c2e34ab8f`
- Land topology SHA-256: `dd529568ced59493730f6f6ff24bec4d9980eb07def9fdd4a713269de6c36b42`

`map/` **пока не содержит сами PNG/SVG/topology master-файлы** — только их проверенные исторические хэши. Это repository/source migration blocker для физического STABLE/PnP, но не блокирует цифровую Arena RC2: карта и canonical land/sea graph встроены в HTML-билд.

Известный долг: исторический topology JSON V5.7.1 имеет неверную внутреннюю версию V5.6.6; при миграции master topology метаданные должны быть исправлены без изменения географии.
