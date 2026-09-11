# Cards

## Canonical gameplay / physical-design data

`cards/canonical_registry_v5.7.2.json` is generated verbatim from the active Master Game Data physical card-design sheets.

Current generated inventory:

- **111** editable card designs;
- **48** globally unique `CARD_ID` values;
- groups: Events 30, Houses 6, Characters 48, Advisors 9, Ambitions 18;
- rows without gameplay IDs receive only an internal namespaced registry row identity; no new gameplay ID is written into MGD/card data.

Known physical copy count from current canonical data:

- Events 30;
- Houses 6;
- Characters 48;
- Advisors **18** (`9 types × Копий: 2`);
- Ambitions 18;
- **known total: 120 physical cards**.

Generate/check:

```bash
node tools/generate_card_registry_v5_7_2.js
node tools/generate_card_registry_v5_7_2.js --check
node tools/audit_card_quantities_v5_7_2.js
```

## HTML preprint source

Editable source is stored in `visual/html_v22/`:

- `card_editor.html` — edit text/data presentation and per-card art;
- `print_studio.html` — A4 3×3 print layout; expands the MGD `Копий` field automatically.

Gameplay fields are locked by default in the editor. Editing them does not become canonical until MGD/Rules are synchronized and the registry is regenerated.

## Remaining blocker

The historical Visual RC contained **160** physical cards. Current canonical source reconstructs **120**. The missing **40** correspond to the absent `Intrigues` card source: current MGD has no `Intrigues` sheet, and current rules do not provide a full canonical intrigue deck/card text list.

This is a source/data blocker. Missing intrigue cards must not be reconstructed by assumption.

Illustration/art masters, card backs and certified print-ready output also remain separate preprint tasks.
