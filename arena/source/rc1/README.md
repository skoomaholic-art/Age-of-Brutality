# RC1 compressed baseline — incomplete historical source

The `.b64` files in this directory are **not a complete reproducible Arena source**.

Audit on 2026-09-11:

- concatenation with the repair chunk in the historically intended location can be inflated only with tolerant gzip handling;
- recovered partial HTML size observed: about **203111 bytes**;
- an alternative concatenation recovers about **220084 bytes**;
- both recovered variants contain `window.ARENA_DATA`;
- neither contains `class ArenaEngine`;
- neither contains the closing `</body>` marker.

No later `part-04`, `part-05` or equivalent missing tail exists in the Git history checked during the rebuild.

Conclusion: these chunks are retained only as historical forensic material. They must not be used to claim that RC1/RC2 is reproducible. A complete Arena baseline/HTML must be migrated before the current patches can be packaged into a new verified executable.