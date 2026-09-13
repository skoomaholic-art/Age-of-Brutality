# Cards

## Canonical inventory

The complete card set is the union of two tracked sources:

- `canonical_registry_v5.7.2.json` — 111 base designs / 120 physical copies generated from active MGD;
- `../data/intrigues_v5.7.2.json` — 40 designs / 40 physical copies from the explicit canonical new-design module.

`canonical_card_set_v5.7.2.json` records the composite total: **151 designs / 160 physical cards**.

Base groups: Events 30, Houses 6, Characters 48, Advisors 9 designs / 18 copies, Ambitions 18. Intrigues add 40 unique `INT-01` … `INT-40` cards.

Generate/check:

```bash
node tools/generate_card_registry_v5_7_2.js
node tools/generate_card_registry_v5_7_2.js --check
node tools/audit_card_quantities_v5_7_2.js
node tools/build_intrigue_cards_v5_7_2.js
```

## Preprint source

- `visual/html_v22/card_editor.html` — editable base-card presentation;
- `visual/html_v22/print_studio.html` — A4 3×3 base-card layout with copy expansion;
- `generated/Zhestokiy_Vek_Intrigues_V5.7.2_40.html` — reproducible Intrigue preprint.

The data inventory is complete. Final illustration masters, backs, consolidated 160-card prepress output and physical print proof remain separate release tasks; therefore the project is not yet print-ready.
