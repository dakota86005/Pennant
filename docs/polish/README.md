# Pennant for Mac: the polish push (N15a)

The owner tested the first signed Pennant for Mac on 2026-10-14 and found that it reads like an alpha: wordy, hard to read and computer-voiced, with bugs found within minutes. This folder tracks the polish push that follows, before the N15 acceptance and cutover in [SWIFTUI_REBUILD.md](../SWIFTUI_REBUILD.md).

The owner's instruction is that **every item here gets addressed**.

| File | What it is |
|---|---|
| [BUG_LIST.md](BUG_LIST.md) | The ranked bug list. Round 1 is a screen-and-payload hunt of every department (205 findings, each checked against the code, merged by root cause into B-01 to B-56). The deep code hunt adds its items from B-57. It also lists the refuted findings and the fix batches. |
| [bugs.json](bugs.json) | The same items and batches, machine-readable, each with a `status`. |
| [VOICE.md](VOICE.md) | How Pennant talks: the owner's approved anchor sample and the rules. A draft until the owner approves it. |
| [SAMPLES.md](SAMPLES.md) | Six of the owner's screens rewritten in that voice, with the facts each rewrite needs from the deterministic code. |
| [PHRASEBOOK.md](PHRASEBOOK.md) | The design for one server-side phrasebook: words as written content, facts still deterministic. It includes the draft D-077. |

## How an item is closed

- A fix PR names the B-ids it closes. It sets each one's `Status:` line in BUG_LIST.md and its `status` in bugs.json to `fixed (#PR)`.
- An item the phrasebook migration absorbs (marked in the list) is closed by that department's wording PR, not fixed twice.
- An item that turns out wrong is set to `refuted` with its reason, never deleted.
- Each batch is one PR into `feature/swiftui`. It gets an independent review and the full CI gate, and the owner sees a before-and-after page.

## The order

1. Batches 1 to 9 (behaviour, data and layout), from [BUG_LIST.md](BUG_LIST.md) "Proposed fix batches". Each batch fixes one cause in every department.
2. The phrasebook (D-077) and batch 10 (words), department by department, once the owner approves the voice.
3. The visual finish, then N15 acceptance.
