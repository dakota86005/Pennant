# Pennant for Mac: the polish push (N15a)

The owner tested the first signed Pennant for Mac on 2026-10-14 and found that it reads like an alpha: wordy, hard to read and computer-voiced, with bugs found within minutes. This folder tracks the polish push that follows, before the N15 acceptance and cutover in [SWIFTUI_REBUILD.md](../SWIFTUI_REBUILD.md).

The owner's instruction is that **every item here gets addressed**.

| File | What it is |
|---|---|
| [BUG_LIST.md](BUG_LIST.md) | The ranked bug list. Round 1 hunted screens and payloads in every department: 205 findings, merged into B-01 to B-56. Round 2 was eleven deep code reviews: 240 findings, merged into B-57 to B-106. It also lists refuted findings, the 25 fix batches and the owner decisions they wait on. |
| [reviews/](reviews/) | The eleven round-2 code reviews in full, plus every finding's verdict. |
| [bugs.json](bugs.json) | The same items and batches, machine-readable, each with a `status`. |
| [VOICE.md](VOICE.md) | How Pennant talks: the owner's anchor sample and the rules. Approved 2026-10-14 (D-077). |
| [SAMPLES.md](SAMPLES.md) | Six of the owner's screens rewritten in that voice, with the facts each rewrite needs from the deterministic code. |
| [PHRASEBOOK.md](PHRASEBOOK.md) | The design for one server-side phrasebook: words as written content, facts still deterministic. Accepted as D-077. |

## The owner's decisions (2026-10-14)

- **The voice is approved** (D-077): facts stay deterministic, and the words become written content in one YAML/ICU phrasebook.
- **Sample sizes** on the face are real counts (plate appearances, innings), never the weighted sample.
- **A single tool** is described by the scouts' grade ("his glove is among the best there"); the blended figure is in *Why?*.
- **A place against the role** stays "near the bottom of the league's regular left fielders". No computed "bottom 5%".
- **On a 20–80 save,** the face may say "a 70 glove".
- **The React app** gets the new words wherever they come from the shared server code, with no React-only work.
- **Variant wording** is fixed per player.
- **Testing on real data:** no OOTP save on the owner's Mac needs protecting during testing, so builders and fixers may use the real save. This is about test data only. The product rule is unchanged: Pennant never writes OOTP files (D-021).

## How an item is closed

- A fix PR names the B-ids it closes. It sets each one's `Status:` line in BUG_LIST.md and its `status` in bugs.json to `fixed (#PR)`.
- An item the phrasebook migration absorbs (marked in the list) is closed by that department's wording PR, not fixed twice.
- An item that turns out wrong is set to `refuted` with its reason, never deleted.
- Each batch is one PR into `feature/swiftui`. It gets an independent review and the full CI gate, and the owner sees a before-and-after page.

## The order

The 25 batches in [BUG_LIST.md](BUG_LIST.md) "Fix batches" run in order:
1. Data loss, save-switch and identity, and doctrine breaches.
2. Correctness.
3. Robustness and performance.
4. Mac behaviour and accessibility.
5. Retiring and modernising old code.
6. The words, last (the phrasebook, D-077).

The owner answered every decision on 2026-10-28 ("all as recommended"); they're recorded at the end of BUG_LIST.md.
