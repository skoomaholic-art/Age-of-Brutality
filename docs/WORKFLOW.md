# Рабочий процесс проекта «Жестокий Век»

## Единственный источник истины

GitHub `skoomaholic-art/zhestokiy-vek` / `main` является единственным рабочим source of truth проекта.

Файлы из чата, локальные builds и исторические binaries считаются релизными артефактами только если их source, manifest, hash и QA зафиксированы в GitHub.

## Порядок проверки изменения

Каждое изменение проходит цепочку:

`RULES → DATA → CARDS → MAP → ARENA → AI → QA → PLAYTEST → VISUAL/PRINT`

Нельзя исправить один слой и оставить зависимый слой с другим числом, ID, условием или state transition.

## Canonical checks

Перед merge и на `main` должны проходить read-only проверки:

```bash
node tools/reconcile_v5_7_2.js --check
node tools/generate_card_registry_v5_7_2.js --check
node tools/check_map_topology_v5_7_2.js
```

CI не должен сам переписывать `main`: генерация выполняется до merge, CI только валидирует результат.

## Executable Arena

Нельзя объявлять новый RC/STABLE только по наличию source patch или исторического hash.

Новый executable требует:

1. complete baseline/source;
2. воспроизводимый build из repo;
3. static/canonical checks;
4. Game Master regression;
5. real-browser smoke;
6. manifest + SHA-256;
7. commit/release в GitHub.

Исторический executable, source которого не воспроизводится из текущего repo, остаётся historical evidence и не считается текущей сборкой.

## Обработка фидбэка

`ФИДБЭК → АНАЛИЗ → SOURCE FIX → SYNC DEPENDENCIES → CHECKS/QA → BUILD → PLAYTEST → COMMIT/RELEASE`

Отсутствующий master-файл нельзя заменять восстановлением «по памяти». До фактической миграции он фиксируется как source-availability blocker.
