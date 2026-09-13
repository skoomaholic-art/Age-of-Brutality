#!/usr/bin/env python3
"""Build the current user-delivery ZIP from the checked-out repository.

This script does not invent or repair missing game content. It packages the
current tracked/canonically generated material and writes explicit blockers into
the delivery status file.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DELIVERY = REPO / "delivery"
ROOT = DELIVERY / "Жестокий_Век_V5.7.2_CURRENT"
ZIP_PATH = DELIVERY / "Жестокий_Век_V5.7.2_CURRENT_FULL_PACKAGE.zip"
SHA_PATH = DELIVERY / "SHA256.txt"
GENERATED = REPO / "release" / "generated" / "V5.7.2-DEV"


def copy_file(src: str | Path, dst: str | Path) -> None:
    src_p = REPO / src if not isinstance(src, Path) or not src.is_absolute() else src
    dst_p = ROOT / dst if not isinstance(dst, Path) or not dst.is_absolute() else dst
    if not src_p.is_file():
        raise FileNotFoundError(f"required file missing: {src_p}")
    dst_p.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_p, dst_p)


def copy_tree(src: str | Path, dst: str | Path) -> None:
    src_p = REPO / src if not isinstance(src, Path) or not src.is_absolute() else src
    dst_p = ROOT / dst if not isinstance(dst, Path) or not dst.is_absolute() else dst
    if not src_p.is_dir():
        raise FileNotFoundError(f"required directory missing: {src_p}")
    shutil.copytree(src_p, dst_p, dirs_exist_ok=True)


def git_head() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
    ).strip()


def write_status(sha: str) -> None:
    text = f"""# ЖЕСТОКИЙ ВЕК — АКТУАЛЬНЫЙ ПАКЕТ V5.7.2-DEV

Источник упаковки: GitHub `main` commit `{sha}`.

## Что находится в пакете

- текущие правила V5.7.2-DEV;
- Master Game Data и канонические data-модули;
- полный composite registry: 151 дизайн / 160 физических карт;
- 120 базовых карточек: общий PDF, HTML и ZIP индивидуальных PDF;
- 40 Интриг нового canonical design module: отдельный воспроизводимый HTML-preprint;
- каноническая топология карты: 52 территории / 81 сухопутное ребро / 23 морских маршрута / 16 портов;
- текущий topology-preview карты;
- визуальные шаблоны карточек, visual guides и component usage guide;
- текущие материалы по физическим жетонам/маркерам, насколько они определены в проекте;
- current standalone Arena, manifest и source/recovery materials;
- AI House Agents, Prisoner Agent и конфигурация AI;
- Game Master runner и QA/playtest reports;
- единый current-state и ledger подтверждённых решений;
- полный source snapshot текущего repository main.

## Текущий цифровой статус

- Current Arena воспроизводится из tracked source.
- Все 16 обычных действий и 2 свободные процедуры доступны; source-blocked actions нет.
- Current Game Master gates: 100/100 и 500/500 партий, R6/108 slots, 0 engine errors, 0 invalid actions.

## ВАЖНО: текущие незакрытые блокеры

1. **Карточки:** data полного набора 151/160 зафиксированы, но единый сертифицированный 160-card PDF с финальными backs/art и физическая проба ещё не готовы.
2. **Карта:** каноническая topology и технический PNG актуальны, но финальный editable illustrated/print master не утверждён.
3. **Жетоны/компоненты:** полный утверждённый Component BOM и все production masters не зафиксированы.
4. **Arena release:** перед продвижением DEV в STABLE требуется зафиксированный real-browser smoke.

Подробности: `00_CURRENT_PROJECT_STATE.md`, `00_PROJECT_DECISIONS.md`, `00_KNOWN_ISSUES.md`.

Модуль 40 Интриг явно помечен как новый канонический дизайн, а не как восстановленный historical source.
"""
    (ROOT / "00_СТАТУС_АКТУАЛЬНОЙ_ВЕРСИИ.md").write_text(text, encoding="utf-8")


def build() -> tuple[Path, str]:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    DELIVERY.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    for folder in (
        "01_ПЕЧАТЬ_КАРТОЧКИ",
        "02_КАРТА",
        "03_ПРАВИЛА",
        "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА",
        "05_ВИЗУАЛ_ЖЕТОНЫ_КОМПОНЕНТЫ",
        "06_ARENA_AI_GAME_MASTER",
        "07_ПОЛНЫЙ_SOURCE",
    ):
        (ROOT / folder).mkdir(parents=True, exist_ok=True)

    copy_file(GENERATED / "Жестокий_Век_Карточки_Current_120.pdf", "01_ПЕЧАТЬ_КАРТОЧКИ/Жестокий_Век_Карточки_Current_120.pdf")
    copy_file(GENERATED / "Жестокий_Век_Карточки_Current_120.html", "01_ПЕЧАТЬ_КАРТОЧКИ/Жестокий_Век_Карточки_Current_120.html")
    copy_file(GENERATED / "Жестокий_Век_Карточки_Individual_Current_120.zip", "01_ПЕЧАТЬ_КАРТОЧКИ/Жестокий_Век_Карточки_Individual_Current_120.zip")
    copy_file("cards/canonical_registry_v5.7.2.json", "01_ПЕЧАТЬ_КАРТОЧКИ/canonical_registry_v5.7.2.json")
    copy_file("cards/canonical_card_set_v5.7.2.json", "01_ПЕЧАТЬ_КАРТОЧКИ/canonical_card_set_v5.7.2.json")
    copy_file("cards/generated/Zhestokiy_Vek_Intrigues_V5.7.2_40.html", "01_ПЕЧАТЬ_КАРТОЧКИ/Zhestokiy_Vek_Intrigues_V5.7.2_40.html")
    copy_file("cards/README.md", "01_ПЕЧАТЬ_КАРТОЧКИ/CARDS_README.md")

    copy_tree("map", "02_КАРТА/map")
    copy_file("visual/map/Жестокий_Век_Карта_Topology_Preview_V5.7.2.pdf", "02_КАРТА/Жестокий_Век_Карта_Topology_Preview_V5.7.2.pdf")
    copy_file("visual/map/README.md", "02_КАРТА/VISUAL_MAP_README.md")

    copy_tree("rules", "03_ПРАВИЛА/rules")

    copy_tree("data", "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА/data")
    copy_file("cards/canonical_registry_v5.7.2.json", "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА/canonical_registry_v5.7.2.json")
    copy_file("VERSION", "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА/VERSION")
    copy_file("CHANGELOG.md", "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА/CHANGELOG.md")
    copy_file("RELEASE_MANIFEST.md", "04_ДАННЫЕ_ПЕРСОНАЖИ_ДОМА/RELEASE_MANIFEST.md")

    copy_tree("visual", "05_ВИЗУАЛ_ЖЕТОНЫ_КОМПОНЕНТЫ/visual")
    copy_tree("components", "05_ВИЗУАЛ_ЖЕТОНЫ_КОМПОНЕНТЫ/components")

    copy_tree("arena", "06_ARENA_AI_GAME_MASTER/arena")
    copy_tree("ai", "06_ARENA_AI_GAME_MASTER/ai")
    copy_tree("qa/game-master", "06_ARENA_AI_GAME_MASTER/qa/game-master")
    copy_tree("qa/rules", "06_ARENA_AI_GAME_MASTER/qa/rules")
    copy_tree("qa/reports", "06_ARENA_AI_GAME_MASTER/qa/reports")

    copy_file("docs/CURRENT_PROJECT_STATE.md", "00_CURRENT_PROJECT_STATE.md")
    copy_file("docs/decisions/2026-09-12_project_chat_reconciliation.md", "00_PROJECT_DECISIONS.md")
    copy_file("docs/KNOWN_ISSUES.md", "00_KNOWN_ISSUES.md")
    copy_file(GENERATED / "RECOVERY_MANIFEST.json", "RECOVERY_MANIFEST.json")
    copy_file(GENERATED / "README.md", "00_RECOVERY_README.md")

    sha = git_head()
    write_status(sha)

    source_zip = ROOT / "07_ПОЛНЫЙ_SOURCE" / "Age-of-Brutality-main-source.zip"
    subprocess.run(
        ["git", "archive", "--format=zip", f"--output={source_zip}", "HEAD"],
        cwd=REPO,
        check=True,
    )

    archive_base = DELIVERY / "Жестокий_Век_V5.7.2_CURRENT_FULL_PACKAGE"
    made = Path(shutil.make_archive(str(archive_base), "zip", root_dir=DELIVERY, base_dir=ROOT.name))
    if made != ZIP_PATH:
        raise RuntimeError(f"unexpected archive path: {made}")

    digest = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()
    SHA_PATH.write_text(f"{digest}  {ZIP_PATH.name}\n", encoding="utf-8")
    print(f"package={ZIP_PATH}")
    print(f"bytes={ZIP_PATH.stat().st_size}")
    print(f"sha256={digest}")
    return ZIP_PATH, digest


if __name__ == "__main__":
    build()
