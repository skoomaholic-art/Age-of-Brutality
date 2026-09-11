# Release

There is currently **no executable release in GitHub that matches the post-reconciliation V5.7.2 source**.

`V5.7.2-PLAYABLE-RC2` remains the last historically verified executable by manifest/hash and 500-seed QA, but its exact HTML is absent and the current source contains newer fixes.

A new digital RC requires:

1. migrate a complete Arena baseline/HTML;
2. build the executable from repository source;
3. run canonical static checks;
4. run Game Master regression;
5. run real-browser smoke;
6. commit artifact + manifest + hash + QA.

Physical/PnP STABLE additionally requires migrated card layout/art masters, illustrated map master, Components/BOM and a reproducible print package.