# Cards

## Canonical gameplay data

`cards/canonical_registry_v5.7.2.json` is generated verbatim from the active Master Game Data and is the machine-readable V5.7.2 card/object registry currently stored in GitHub.

Current generated inventory:

- **96** card-like/game objects;
- **48** globally unique `CARD_ID` values;
- generic IDs are namespaced by their MGD sheet.

Generate/check:

```bash
node tools/generate_card_registry_v5_7_2.js
node tools/generate_card_registry_v5_7_2.js --check
```

The registry contains gameplay data, IDs and text present in MGD. It does **not** replace physical print layout, illustration/art masters or historical XLSX formatting.

## Remaining blocker

The editable physical V5.7.2 card layout/art master is not migrated to GitHub. This blocks PnP/STABLE, but no longer means that card gameplay data exists only in a missing spreadsheet.