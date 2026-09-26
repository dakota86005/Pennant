---
paths:
  - "docs/SWIFTUI_REBUILD.md"
---

# Pennant for Mac (the SwiftUI rebuild): working reminder

This is a router, not the doctrine. The canonical detail is in `docs/SWIFTUI_REBUILD.md` and `docs/DECISIONS.md`
D-055 to D-060 (with D-001, D-008, D-018, D-020, D-041, D-049 and D-052's amendment of 2026-09-25). Where this file
and those documents differ, they win. The presentation cases are in `docs/BEHAVIOR_CASES.md` "Pennant for Mac".

- **The server decides and writes; Swift renders.** Swift code holds no baseball threshold, computes no ranking,
  place or verdict, and writes no copy beyond structural labels (menu, tab and column names in the String Catalog).
  A number shown is a number served. If a view needs a sentence or a judgment, add it to the server's payload.
- **Every visible sentence is a server `Claim`, `Row` or `Cell`** under `/api/v2/`, with its basis. Keep the
  plain-language rule (AGENTS.md "Writing for the GM") in the TypeScript that authors it; the banned-jargon list is
  one file, `tests/bannedJargon.ts`, and a script checks the String Catalog against it.
- **The contract is generated.** Change TypeScript types, run `npm run contract:build`, commit `contract/openapi.json`.
  Never hand-write a Swift model of a server type. Closed unions are open enums; game dates are unpadded strings,
  never parsed as dates in Swift.
- **Unknown stays unknown** in Swift too: a null sort key sorts last both ways, a missing value shows the served
  sentence, never zero, a dash read as zero, or an empty chart that looks like "none".
- **Server changes are additive while the React app lives.** New tables and files only; old routes keep working;
  the data folder is shared with the Electron app (D-049 hold) and protected by `server.lock`.
- **Glass on the controls layer only**; content opaque; colour never the only signal; every depth layer keyboard- and
  VoiceOver-reachable. macOS 26 minimum: a macOS 27 API only behind `#available` with a macOS 26 path.
- **Never commit** save data, fixtures from a private save (fixtures come from `tests/syntheticSave.ts`), signing
  material, provisioning profiles, team secrets or `xcuserdata`.
- New Swift or npm dependencies need the owner's approval (SWIFTUI_REBUILD.md section 9 lists the approved set).
- **Widen `paths:` as the rebuild lands.** Add `macos/**`, `contract/**`, `server/contract/**`,
  `server/presentation/**`, `server/sidecar.ts` and `tests/bannedJargon.ts` in the milestone that creates the first
  tracked file under each; `tests/agentInstructions.test.ts` rejects a path that matches nothing yet.
- Verify with `macos/scripts/test.sh` plus the server baseline; visual checks come from XCUITest and
  `ImageRenderer` PNGs, not from asking the owner to look.
