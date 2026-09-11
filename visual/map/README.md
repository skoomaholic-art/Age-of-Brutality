# Styled Map — V5.7.2-VISUAL-RC1

Visual RC1 uses the canonical Final Illustrated map as geometry source and changes **visual treatment only**.

## Canonical lock

Verified unchanged canonical groups:
- land/territory adjacency;
- `Canonical Ports`;
- `Canonical Sea Edges`;
- central-island A/B pairing.

## Committed PDF preview

A technical PDF preview is now stored in the repository:

- `Жестокий_Век_Карта_Topology_Preview_V5.7.2.pdf`
- SHA-256: `3d152a6769a232f8e9ebc26c98a3ee82eeaeb76ebaa13369b46c1b221369e39e`
- source: `data/master_game_data_v5.7.2-dev.json`
- contains: 52 nodes, 81 canonical land edges, 23 canonical direct sea edges, 16 canonical ports.

This PDF is a **technical topology preview**. Node positions are schematic and therefore it does **not** replace the missing `Final Illustrated V5.7.1` geometry master. It exists so the currently committed repository has a directly viewable/printable map artifact whose graph can be checked against Master Game Data.

## Historical styled artifacts

The earlier styled artifacts are still recorded by hash, but their source files are not yet physically migrated into the repository:

- Styled SVG: `Жестокий_Век_Карта_Styled.svg`
- historical SVG SHA-256: `5223ca43e8020798782408537d23702dcd2872196485aaa2d045f73b73698efc`
- historical Print PDF SHA-256: `94917dc3bfb769e86a40fd192aaf76fd10c4013f56c00e42032e0e0bb9430ad9`

Новые территории, порты и маршруты в topology preview не добавлялись.
