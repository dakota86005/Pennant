# The phrasebook: design and recommendation

*Draft for the owner\'s approval (N15 polish push, 2026-10-14). Nothing in the app follows it until the owner approves.*

*N15 draft. How Pennant's words become written content in one place, fed by typed facts from the deterministic code.*

## The recommendation, in short

- Write the words in **YAML content files**, one per department, using standard **ICU message syntax** for placeholders, plurals and selects.
- A build step **compiles them into a typed TypeScript module**, the same way the contract is built today. A drift test fails if the YAML and the compiled module disagree.
- The specialists **stop writing English**. They emit typed findings (a kind plus its values), and `server/presentation/**` picks the message and fills it.
- The app keeps receiving **served text** in the same `Claim`, `Row` and `Cell` shapes. The Swift app doesn't change for the words, only where a section moves behind *Why?*.
- **Wording bands** ("near the bottom", "among the best", "a small sample") live in the phrasebook and only describe judgements the code already made. A boundary test keeps them out of the decision path.

## 1. The format

### What the owner edits

One file per department under `server/phrasebook/` (`majorLeague.yaml`, `farm.yaml`, `frontOffice.yaml`, `dataStatus.yaml`, …), plus two shared ones: `words.yaml` (positions, levels, name forms, list joining) and `bands.yaml` (the wording bands). A message looks like this:

```yaml
# The first line of a flagged regular: his decision page, his desk item, the widget.
mlb.review.headline:
  facts:
    player: player        # name forms: full, short, last
    position: position    # word forms: place ("left field"), man ("left fielder"), regulars
    weakPart: [bat, glove, both]
  say: >-
    {weakPart, select,
      bat   {{player, name, full} isn't hitting enough to hold {position, pos, place}.}
      glove {{player, name, full} isn't fielding well enough to hold {position, pos, place}.}
      both  {{player, name, full} isn't doing enough at the plate or in the field to hold {position, pos, place}.}
    }
  short: >-
    {weakPart, select,
      bat   {{player, name, last} isn't hitting enough for {position, pos, short}}
      glove {{player, name, last}'s glove is a worry in {position, pos, short}}
      both  {{player, name, last} is struggling in {position, pos, short}}
    }

mlb.review.startsAt:
  facts: { starts: count, innings: count, position: position }
  say: >-
    {starts, plural, =0 {No starts} one {# start} other {# starts}} in {position, pos, short}
    {innings, plural, one {(# inning)} other {(# innings)}}
```

What a person needs to know to edit one:
- Text in `{braces}` is filled in from the facts. Everything else is just the sentence.
- `{n, plural, one {…} other {…}}` handles "1 start" and "3 starts". `#` is the number.
- `{kind, select, a {…} b {…}}` picks a sentence by kind. Every kind listed under `facts` must have a sentence; the build says which is missing.
- `{x, name, last}`, `{x, pos, place}` and `{x, band, share}` are Pennant's own formatters: name forms, position words, wording bands.
- `variants:` (a list instead of `say:`) gives two or three wordings of the same line. They're picked deterministically, never at random, so a page doesn't say the same sentence five times and the same player reads the same way every day.
- `short:` is the form for the widget, the menu bar and Spotlight.
- A `#` comment is a note to the next writer. It never ships.

### Why YAML and ICU, not TypeScript or JSON

| | TS modules | JSON | **YAML + ICU, compiled** |
|---|---|---|---|
| The owner can read and edit it | Template literals, `${…}` and code around every sentence | Quotes and escapes everywhere, no comments | Plain sentences, comments, multi-line |
| Plurals and grammar | Hand-written helpers (there are at least five `plural()` copies today) | Needs a format anyway | ICU plurals and selects, a documented standard |
| Type safety | Native | None | The compiler generates a facts type per message, so `say()` calls are type-checked |
| Runtime cost | None | Parsing at start | None: compiled functions, no YAML or ICU parser in the sidecar |
| Fits the repo | — | — | Same pattern as `contract:build`: committed output and a drift test |

Build-time dependencies only: a YAML parser and an ICU parser (`yaml` and `@formatjs/icu-messageformat-parser`, pinned, as devDependencies). The runtime adds none.

### What's in the shared files

- **`words.yaml`**: positions (2 to 10) in every form a sentence needs: `place` "left field", `man` "left fielder", `men` "left fielders", `short` "left", `regulars` "the league's regular left fielders". Also levels ("Triple-A"), club short names (the city or nickname the save uses), name forms, and list joining ("A, B and C"; "and 3 more").
- **`bands.yaml`**: the wording bands (section 3).
- **Basis codes** (`observed`, `documented`, `observed_and_documented`, `export_state`, `owner_attested`, and the D-041 kinds calibrated, provisional, policy, fact and recorded), each with its one plain phrase: "every time we've seen it", "the manual says so", "Pennant's starting value, not yet fitted on this save".

## 2. How a finding becomes words

```
specialist (roleReview, playerRights, farmConsequence, …)
   └─ typed finding: { kind: 'results_behind_tools', results: 8, tools: 29 }
        │   (decides everything: whether, how strongly, in what order)
        ▼
server/presentation/<dept>/   ── picks the message key from the finding's kind,
        │                         passes the facts, builds Claim / Row / Cell
        ▼
server/phrasebook/  say(key, facts, { surface, variantSeed }) → string
        │   (decides nothing: fills a template, picks a band word, a plural, a variant)
        ▼
Claim.text / Claim.hint / basis.because[].value / Cell.display   (the contract, unchanged)
        ▼
Mac app, widget, menu bar, Shortcuts, Spotlight, AI staff: all read served text
```

**Where it sits.** `server/phrasebook/` holds the YAML, the compiler (`scripts/phrasebook.ts`, run by `npm run phrasebook:build`), the compiled `phrasebook.gen.ts` and `say()`. Only `server/presentation/**` imports `say()`. The specialists import nothing from it. `claim()`, `basis()`, `cell()` and `row()` stay the only way to build a payload. They just receive phrasebook text instead of template literals. The contract types (`Claim`, `Row`, `Cell`, `Target`) don't change, so neither does the generated Swift client.

**What the specialists change.** Today they write English: `roleReview.ts` `explanations` and `wouldChange`, `mlbExplain.ts`, `playerRights.ts` reasons, `farmConsequence.ts` ("1 man holds it and it supports 2"), `mlbEvidence.ts` notes ("3 other player(s)…"), `mlbResponses.ts` group descriptions, Player Development's blockers. Each becomes a typed list: `{ kind, …values }` with a closed union of kinds. This is the bulk of the work, and it's mechanical: the values are already computed right next to the sentence.

**What the app receives: still served text (recommended).** Keys plus values were considered and rejected:
- Two clients would each have to own the voice again. That's the drift D-056 was written to stop.
- The widget, menu bar, Shortcuts and Spotlight would each need the formatter. Today they draw served strings (D-075).
- The AI staff read served text through the same API (D-001). Keys would give them nothing to read.
- The banned-words and budget tests would have to run in Swift as well as TypeScript.

Served text keeps the Swift app a renderer and keeps one place where the voice is tested. To trace a string back to its message, a test-only server mode records `{ key, variant }` beside each string it builds. That's for the repetition and budget tests, never a contract field.

## 3. Number words

Three kinds of number reach the page, and each gets words differently. In every case the raw number moves to *Why?* or the hover, once, with what it means.

### a. A true share of peers → a band word, or a plain percentage

Some numbers really are "better than N% of big-league hitters": a hitter's tools share and results share, his glove grade's share at the position, his running, the weakest core tool. Only these may be said as a percentage. D-065's rule stays: a blended read (the working estimate) is a place on a scale, never "better than N%".

```yaml
# bands.yaml — wording only. Nothing here decides a flag, its strength or an order.
share:                       # the share of big-league peers he's better than, 0–100
  - { from: 95, say: "among the very best" }
  - { from: 85, say: "among the best" }
  - { from: 70, say: "well above average" }
  - { from: 55, say: "above average" }
  - { from: 45, say: "about average" }
  - { from: 30, say: "below average" }
  - { from: 15, say: "well below average" }
  - { from: 5,  say: "near the bottom" }
  - { from: 0,  say: "at the very bottom" }
```

Tawa's glove grade (94) reads "among the best". His bat's tools share (29) reads "below average", and his results share (8) reads "near the bottom".

### b. A place against the role → the specialist's own category, said in words

"Near the bottom of the league's regular left fielders" is a statement about the role's lines (typical, the lowest-tenth floor, the lowest-twentieth deep floor), and the role review already judges it (`belowDeep`, the lens lines, the case's strength). The phrasebook **never compares a number with a line itself**. It receives the category and words it:

```yaml
roleStanding:                # from the review's own category, never recomputed here
  belowDeep:    "near the bottom of {role, pos, regulars}"
  belowFloor:   "among the weakest of {role, pos, regulars}"
  belowTypical: "below the typical {role, pos, man}"
  atTypical:    "about what a typical {role, pos, man} gives"
  aboveTypical: "better than the typical {role, pos, man}"
```

⚑ The review computes these internally (`ratingsLow`, `resultsLow`, `belowDeep`) but serves them only inside the finding's kind and strength. Each needs to be a served field. A precise "bottom 5%" needs a new fact, his place among the role's regulars, which nothing computes today.

### c. Samples and confidence → the code's judgement first, a band only inside it

```yaml
sample:                      # the judgement decides which row applies; the band only refines inside it
  tooEarly:  "It's too early to read much into it"         # finding.kind = too_early
  small:     "It's still a small sample"                    # isFirmRead = false
  fair:      "There's a fair sample behind it"              # isFirmRead = true, reliability < 0.75
  solid:     "There's a solid sample behind it"             # isFirmRead = true, reliability ≥ 0.75
confidence:                  # the staff's call (D-034)
  high: "and the staff are fairly sure"
  moderate: ""
  low: "for now"
```

`small` is chosen because the code says the read isn't firm, not because a number crossed a wording line. The 0.75 inside "firm" only picks between two ways of saying "firm", and a test proves no band can produce "solid" for a read the code calls not firm.

### d. Grades

Where the export carries the 20–80 scale, a scout would say "a 70 glove". Whether the face may say that is an open question for the owner. If yes, it applies only to a single visible rating as the export gives it (D-061), never to a blend.

### Keeping words out of the decision path

- `bands.yaml` compiles into `phrasebook.gen.ts` and nowhere else. **A boundary test** (in the family of `evidenceBoundary.test.ts`) fails if any module outside `server/phrasebook/` and `server/presentation/` imports it, or if the phrasebook imports a specialist's thresholds (`FLOOR_QUANTILE`, `MEANINGFUL_GAP`, `CONCERN`, …).
- Every band is stamped *wording* in the file header. It's not calibrated, provisional or policy (D-041), because it decides nothing.
- **A consistency test** renders every finding category against every band edge and checks that the words never contradict the judgement: no "solid sample" on a read that isn't firm, no "near the bottom" on a holder who isn't flagged, no "step up" on a `sidegrade`.

## 4. Tests that hold the voice

All of them run on the served `/v2` payloads of the synthetic saves, as the banned-words test does today, and on the compiled phrasebook directly.

| Test | What it checks |
|---|---|
| **Budgets** | A headline is at most 12 words (failing at 16, so the 12 is a target, not a cliff). A body is at most 2 sentences. A card shows at most 3 visible lines. A hover is at most 75 characters (already enforced). Which field is a headline, body or card line is declared per payload type, beside `SURFACES`. |
| **Repetition per page** | On one page's visible text (bases excluded), a number token appears once, except in table cells. No 4-word phrase repeats across sentences ("on the 0–100 scale" five times fails). A message key renders at most once per subject per page, except as a list item. |
| **Banned method words** | `tests/bannedJargon.ts` gains face-only patterns: `0–100 scale`, `working estimate`, `\blens(es)?\b`, `read (firm\|limited\|thin)`, `man under review`, `weighted sample`, `trusted \d+%`, `wOBA`, `\(s\)`. They're allowed in a basis, the way folder paths are. |
| **Placeholders and plurals** | At build: every placeholder is a declared fact; every `plural` has `one` and `other`; every `select` covers its declared kinds. At test: every message renders over a matrix (0, 1, 2 and 21 for counts; every kind; empty and long lists; long names) with no `{`, no rendering leak, a capital first letter and closing punctuation on body sentences, and no "1 games", "a 8" or "regular left fielders takes". |
| **No orders** | The existing verdicts (`should`, `must`, `recommend…`, the imperative headlines) plus `you (need\|have) to` and a move verb opening a sentence (`^(Option\|Recall\|Designate\|Release\|Trade\|Sign\|Promote\|Demote\|Bench\|Move\|Call up)\b`). App chores ("Open the save in OOTP") are declared per message as `help`, which allows an imperative about Pennant or OOTP and never about a player. |
| **Variants** | Variant choice is stable for the same subject and seed, and differs across the subjects on one page where variants exist. |
| **Drift** | The committed `phrasebook.gen.ts` equals a fresh build from the YAML. |

## 5. Migration

Department by department, with the owner's pain first. Each step ships on its own, with the owner reading a before-and-after sheet like `SAMPLES.md` built from a scratch copy of the real save.

1. **The machinery, with no visible change.** `server/phrasebook/`, the compiler and its drift test, `words.yaml`, `bands.yaml`, the boundary and consistency tests, and the new banned patterns (switched on per surface as each one migrates, using the existing scoped exceptions to hold the rest).
2. **Major League Ops' decision page and the review's desk item.** This is the Tawa page: `roleReview.ts` explanations and wouldChange, `mlbExplain.ts`, `mlbReport.ts`'s reasons, the candidate cards, the 40-man options (`playerRights.ts` reasons, `mlbResponses.ts` groups), the farm consequence sentences, and the decision page's layout behind *Why?* in the Swift app. The rest of Major League Ops' views follow.
3. **The Front Office.** The Morning Report lede, the desk, the department cards, the roster map and its legend, data status, and the glance's short forms for the widget, menu bar and Spotlight.
4. **Farm & Development**, then Finance and Medical, League Office and Scouting, Trades and Philosophy, the player window, and the AI surfaces' served words (their prompts don't change).

**Does React get the new text?** Yes where the words come from the shared specialists, and no where React writes its own.
- When a specialist stops returning English, the old `/api` routes would lose their sentences. They call the same phrasebook instead, so the React pages show the new wording for free and the two clients never disagree. This is D-056's reason for one server, still holding.
- React's own label maps and word builders are left alone. They retire at cutover (D-055), and rewriting them is wasted work.
- React's layout isn't changed. It may show some lines the Mac app puts behind *Why?*, which is acceptable for a retiring client.

**Risks, and what holds each:**
- **A word quietly changes a meaning.** The consistency test and the boundary test cover this. Every migrated surface also gets a reviewed before-and-after sheet.
- **Byte-identical route pins.** `tests/routeExtractions.test.ts` pins old route bodies byte for byte. Each step re-pins on purpose, with a note naming the changed strings.
- **The AI staff's inputs change.** `answerStaff` and the AI tools read old routes. Their wording changes but their facts don't. Spot-check the Staff room and the GM Briefing after step 2.
- **The owner edits a message and breaks it.** The build names the message, the placeholder and the line. A message can't ship broken because the drift test fails first.
- **Variants make snapshots flaky.** Choice is seeded by key and subject, so snapshots are stable.
- **Budgets fight completeness.** When a fact won't fit the face, it goes to *Why?*. The budget test is never satisfied by dropping basis.
- **Partial migration reads as two voices.** Migrate one surface at a time, whole, never half a page.
- **Startup time.** Compiled functions, no parsing at run time. The sidecar's start budget is unaffected.

## 6. Draft decision (accepted as D-077; the final text is in `docs/DECISIONS.md`)

> ## D-077 — Pennant writes like a person: the words are written content in one phrasebook, filled from typed facts
>
> **Status:** Proposed (N15, 2026-10-13), drafted from the owner's direction of 2026-10-14 and their approved Tim Tawa sample. Refines D-056 and D-065; D-001, D-018, D-023, D-031, D-034, D-052 and D-060 are unchanged. **Implementation:** not started (`server/phrasebook/`, `npm run phrasebook:build`; voice guide: `docs/VOICE.md`).
>
> The owner found the first signed Mac build wordy and machine-like: sentences assembled from parts, "on the 0–100 scale" five times on one page, method words on the face, plurals by hand. The owner asked for Pennant to sound like a person, even if the philosophy of where the words come from changes.
>
> - **Facts stay deterministic; the words become written content.** Every judgement, eligibility, ranking and number is still computed by the specialists, and no LLM is in the path (D-001). What changes is that a specialist no longer writes English. It emits a typed finding (a kind and its values), and the words for each kind are **written** messages in one server-side phrasebook (`server/phrasebook/*.yaml`, ICU syntax, compiled to a typed module with a drift test), with placeholders, plurals, selects, variants and a short form.
> - **D-056 is refined, not reversed.** "The server writes every sentence" stays: the app, the widget, the menu bar, Shortcuts, Spotlight and the AI staff all receive served text in the same `Claim`, `Row` and `Cell` types. What ends is *composing* sentences from fragments in code, in the specialists and in `server/presentation/**`. Presentation picks the message and passes the facts; the phrasebook fills it.
> - **Scale numbers become baseball words on the face.** A place on the 0–100 scale is said as the role's category in words ("near the bottom of the league's regular left fielders"), and a true share of peers as a band word or a percentage ("among the best", "better than 29% of big-league hitters"). The raw number is kept once, in *Why?* or a hover. This replaces D-065's "said as one ('62 on the 0–100 scale')" on the face. D-065's other rule stays: a blended read is never said as a percentage.
> - **Wording bands decide nothing.** "Near the bottom", "among the best" and "a small sample" describe a judgement the code already made. The phrasebook never compares a number with a judgement line, its bands are stamped as wording (not calibrated, provisional or policy, D-041), and a boundary test keeps them out of every specialist.
> - **Show the basis, one click away.** Every claim still carries its basis, its unknowns and what would change it (D-018, D-031, D-056). It moves out of the body into *Why?* and the hover, written in the same voice.
> - **Options, never orders.** A move is offered ("If you want to make a change: …"), never commanded. The banned-verdict list grows to hold that.
> - **The voice is tested**: budgets (a headline of about 12 words, a body of 2 sentences, a card of 3 lines, a hover of 75 characters), repetition per page, banned method words on the face, placeholder and plural correctness, no orders, and the consistency of words with judgements.
> - **The React app reads the same phrasebook** through the old routes until cutover, so the two clients never disagree. React's own words are left to retire with it (D-055).
