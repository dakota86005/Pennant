# Six rewrites, before and after

*Draft for the owner\'s approval (N15 polish push, 2026-10-14). Nothing in the app follows it until the owner approves.*

*N15 voice samples. The values are the ones on the owner's screenshots of the real save (images 2 to 9) or, where marked, the served fixtures in `contract/fixtures/responses/`. Field names are from `origin/feature/swiftui` at b49bc47.*

How to read each sample:
- **Before** is what's on screen today, quoted.
- **After** is the visible text.
- **Why?** is what sits behind the disclosure or the hover.
- **Facts needed** lists what the phrasebook needs from the deterministic code. ⚑ marks a fact the code doesn't compute or serve today.
- **Must stay true** lists the doctrine points the rewrite keeps.

---

## 1. The Tim Tawa decision page

### Before

Headline and chips:
> **Tim Tawa (left fielder): well below the line for regular left fielders; tools and results both point to a weak spot**
> Strong case · Review · Duration not assumed

The problem:
> Tim Tawa (27, lineup regular) rates as a strong case for a look: His working estimate (39) is well below what regular left fielders takes: under the 44 line the lowest twentieth of the league's regulars in the role fall below. Tools 29 on the 0–100 scale, results 8 on the 0–100 scale (293 PA, trusted 37%).
> Tim Tawa: Active
> Working estimate: 39 on the 0–100 scale against MLB lineup regulars
> Tools: 29 on the 0–100 scale against MLB peers
> Results: 8 on the 0–100 scale against MLB peers (293 PA, trusted 37%)
> Usage: Started 36 games at left fielder this season (325 innings, 2 errors).
> Usage: His visible tools imply -11 points of wOBA against the league average.
> How long a replacement would be needed is not known, so it is not assumed: a stopgap and a lasting change are different assignments.
> A flag for your attention, not a move: whether to move him is your call. It says where the evidence points and how sure it is.
> His results (8 on the 0–100 scale) are well behind his visible tools (29 on the 0–100 scale): he is underperforming what the tools suggest, which may correct.
> His glove (94 on the 0–100 scale at left field) is well ahead of his bat (21 on the 0–100 scale): the position, not the bat, is what he is worth.

Why it was flagged: the same estimate sentence again, a gauge ("him 39 … typical 69"), "regular left fielders: unusually weak under 49, well under 44.", "What the estimate is made of: Bat 21 on the 0–100 scale · 71% of the estimate / Glove 84 … · 24% / Running 69 … · 5%", "Not known: His results are only trusted 37% as his level so far.", "What could explain it" (the results-behind-tools and glove-ahead-of-bat sentences a third time), "What would change this: A larger sample of major-league results would firm up the read."

The staff read:
> **The staff read** · Comparable to the back of the group
> Both lenses agree: his tools (29 on the 0–100 scale) and his results (8 on the 0–100 scale) are at the back of the group, and results carry 37% of the estimate. Alek Thomas (+5) is only a marginal upgrade (points of working estimate over him). The simplest way to make room is set out in the plans below.
> (then the results-behind-tools and glove-ahead-of-bat sentences a fourth time, and "A larger sample…" again)

The staff's call:
> **The staff's call** Staff's view: keep watching · Low confidence
> Staff's view: keep watching Tim Tawa: the sample behind his results is still small.
> Because: tools 29 on the 0–100 scale; results 8 on the 0–100 scale (293 PA of weighted sample, trusted 37% as his level). bat 21 on the 0–100 scale; glove 84 on the 0–100 scale at his position (visible grade 94 on the 0–100 scale, results 55 on the 0–100 scale over 325 innings), 24% of the estimate; running 69 on the 0–100 scale, 5%.

Player Development:
> **Player Development is judging: temporary depth and a durable assignment**
> [Duration unknown: judge both | Bench role | Temporary major-league depth | Durable major-league role]
> How long he would be needed is not known, so it is not assumed. Player Development judged both temporary depth and a durable assignment; where the answer differs, the duration decides, and it says so. A temporary assignment can be defensible where a durable role is not. Pennant does not assume how long a player would be needed: where the answer depends on it, it says so. What is defensible is Player Development's call, not this page's.

### After

> **Tim Tawa isn't hitting enough to hold left field.**
> <small>Strong case · from the scouting staff</small>
>
> Over 293 plate appearances his bat ranks near the bottom of the league's regular left fielders, though his glove is among the best there. It's still a small sample, so the staff would keep watching for now.
>
> *If you want to make a change:* Alek Thomas is the only bench option who'd be a step up, and a small one. Optioning Tawa to Reno opens the spot; he has 2 option years left.
>
> ▸ Why?

Below that, the page's other sections keep their places but each opens on one plain line:

> **What the scouts and the numbers say** ▸
> His results are even weaker than his tools suggest, and that kind of gap often closes with more at-bats.
>
> **Who else could play left** ▸ *(the candidate cards, sample 2)*
>
> **How long would you need someone?**
> [Not sure: check both | Off the bench | A short stay | Every day]
> We don't assume. Player Development checked both a short stay and a lasting job, and where they differ, it says so.
>
> **Ways to open a spot** ▸ *(sample 3)*

The footnote "Pennant lists options and their consequences…" goes. The *If you want to make a change* shape already says that, and a hover on the options heading carries it: "Options and what each costs. Nothing's ranked; the call is yours."

### Why? (behind the headline's disclosure)

> **How we read him.** Our read on a hitter blends what the scouts see in his tools with what he's actually done, and leans on results more as the sample grows. Tawa comes out at 39 out of 100 against big-league hitters. A typical regular left fielder is about 69; only about one in ten sits below 49, and one in twenty below 44.
>
> **His bat.** The scouts' view of his bat beats 29% of big-league hitters, and his results beat 8%. Together they put his bat at 21. That's 71% of the read.
>
> **His glove.** The scouts rate his glove in left ahead of 94% of big-leaguers who play there. What he's done there over 325 innings is closer to average (55). Together, 84. That's 24% of the read.
>
> **His legs.** 69, and 5% of the read.
>
> **How much the results count.** 37% so far. 293 plate appearances, with the recent ones counting most, isn't enough to trust them fully.
>
> **What could explain it.** His results trail his tools, and that can correct. And what he gives you is mostly the glove, not the bat.
>
> **What would change the read.** More major-league at-bats.
>
> **How sure the staff are.** Not very. The case is strong, but the sample is small, so the staff's view is to keep watching. A club with no philosophy would see it the same way. *(Or, when the philosophy leaned: "Your club's philosophy moved this from X to Y because…")*
>
> **Where the lines come from.** These are Pennant's starting values; this league hasn't been measured yet. *(Or: "Measured on this save's own seasons.")*
>
> **How long he'd be needed.** Not known, and not assumed: a fill-in and a lasting change are different jobs.

### Facts needed

From `mlbReview.ts` / `roleReview.ts` (the review of the holder) and `mlbReport.ts` (the staff's call):

| Fact | Field today | Notes |
|---|---|---|
| Player, position, age, status | `subject.name`, `position` (7), `age` (27), status | Position words ("left field", "left fielder", "hold left field") come from the phrasebook's position table, never `POSITION_NAME` + "er". |
| Finding kind and strength | `finding.kind = ratings_and_results_weak`, `strength = strong` | Chooses the headline. |
| ⚑ Which part is weak | not served | `weakPart: 'bat' \| 'glove' \| 'both'` (a pitcher: `'stuff' \| 'results' \| 'both'`). The values exist (`est.batValue` 21, `defense.pct` 94, the role's lens lines); the classification has to be made in the specialist, not in the words, so "isn't hitting enough" is never a wording guess. |
| Estimate and role lines | `estimate.value` 39, `standard.typical` 69, `standard.floor` 49, `standard.deepFloor` 44, `standard.label`, `standard.source` | `belowDeep` picks "near the bottom". |
| ⚑ Where he places among the role's regulars | not computed | Today only the band is known (below the line meant to sit at the lowest twentieth, set from pooled gaps). "Near the bottom" is honest. "Bottom 5% of everyday left fielders" would need his actual place among the league's regular left fielders (`roleRank: { below, of }`). |
| Bat: tools share and results share | `ratingsPct` 29, `est.resultsPct` 8, `est.batValue` 21, weight 0.71 | Both are true shares of MLB hitters, so "beats 29%" is allowed. |
| Glove | `defense.pct` 94, `defense.resultsPct` 55, `defense.resultsInnings` 325, blended 84, weight 0.24 | "Among the best there" reads the scouts' grade. See the open question at the end. |
| Running | `running` 69, weight 0.05 | |
| Sample and trust | `sample` 293, `sampleUnit`, `reliability` 0.37, `isFirmRead` false | ⚑ 293 is an *effective, recency-weighted* sample across seasons (`resultsEvidence.ts`), not his plate appearances. "Over 293 plate appearances" is only true if the code serves the raw count (`plateAppearances`), or if the words say "about 293, recent ones counting most". |
| ⚑ Explanations as typed facts | `explanations: string[]` | Today these are English. They need to become `{ kind: 'results_behind_tools', results: 8, tools: 29 }`, `{ kind: 'glove_ahead_of_bat', glove: 94, bat: 21, position: 7 }`, and so on. |
| What would change it | `wouldChange: string[]` | ⚑ Also needs typing (`{ kind: 'more_results' }`). |
| Staff's call | `recommendation.code = MONITOR`, `confidence = low`, the rubric's reasons, `lean` | "would keep watching" is MONITOR's phrase. |
| Candidates who'd be a step up | the candidates, each with `comparison.verdict` and its path | ⚑ The headline's "the only bench option" needs a typed path kind on each candidate (`role_change` for the bench, `recall`, `add_to_forty_man`). The labels exist (`PATH_LABEL`), but the decision card shows a display string. |
| The plan that opens the spot | the 40-man options group `routine`, the plan for Tawa: `option`, destination Reno Aces (AAA), `optionYearsLeft` 2 | From Player Rights (D-023) and the farm consequence. |
| Duration | `horizon.kind = unknown` | |

### Must stay true

- **It's a flag, not a move** (D-031, D-034). The headline describes; the staff's view is "would keep watching"; the change is offered under *If you want to make a change*. There's no "should".
- **Show the basis.** Every number on today's page is still behind *Why?*, once each, with the lines' source (starting values or the save's own) and how sure the staff are.
- **Unknowns stay unknown** (D-018, D-027). The duration is never assumed, and a small sample is said as a small sample, never as "bad".
- **One lens per claim.** The bat words use the bat's own shares; "near the bottom" uses the role's lines. Neither is called a percentile unless it is a true share of peers (D-065's rule, kept).
- **The lean is shown, never hidden** (D-036): behind *Why?*, beside what a club with no philosophy would see.
- **No odds or posture** (D-060).

---

## 2. A comparison candidate card: Alek Thomas

### Before

> **Alek Thomas** 26 · On the bench
> Estimate 43 · Tools 25 · Results 23 *(three bars)*
> His estimate is 43% results, 57% tools.
> Weakest core tool: 18 on the 0–100 scale
> This season: AVG .243 · OBP .282 · SLG .297 · HR 0 (39 PA)
> Started 3 games at left fielder this season (27 innings, 0 errors).
> His visible tools imply -13 points of wOBA against the league average.
> ● Marginal upgrade · Against the man under review +5 over him · read firm
> Can be done now

### After

> **Alek Thomas** · 26 · on the bench
> A small step up on Tawa, and we've seen enough of him to say so.
> Hitting .243/.282/.297 with no homers in 39 plate appearances; 3 starts in left.
> Player Development: fine to use him now.
>
> ▸ Why?

The three bars stay. They're the picture, and they need no sentence. Their labels become "Our read", "Scouts", "Results" ("Overall" is OOTP's own figure and stays banned), and the hover on each carries its number and meaning.

For contrast, the next card (Ildemaro Vargas, a downgrade) reads:

> **Ildemaro Vargas** · 34 · on the bench
> Would be a step down from Tawa, and we've seen enough of him to say so.
> Hitting .321/.367/.429 in 30 plate appearances; 1 start in left.
> Player Development: fine to use him now.

### Why?

> **Against Tawa.** Our read on Thomas is 43, against 39 for Tawa. That's a small gap. We have both the scouts' view and enough big-league results on Thomas to read him.
> **His bat.** The scouts' view beats 25% of big-league hitters; his results beat 23%. His tools point to a bat about 13 points of wOBA below the league average.
> **How the read is built.** 43% his results, 57% the scouts' view, since 39 plate appearances is a small sample.
> **His weakest tool.** {tool}, which beats only 18% of big-league hitters.
> **Getting him in the lineup.** He's already on the active roster, so it's a lineup change, not a transaction.

### Facts needed

| Fact | Field today | Notes |
|---|---|---|
| Name, age, status | `player`, `age` 26, `relation`, status | ⚑ Status as a kind (`bench`, `current`, `add_to_forty_man`, `recall`) instead of the display string "On the bench" / "Add to 40-man, level 2". |
| Verdict against the subject | `comparison.verdict = marginal`, `comparison.certainty = adequate`, `comparison.delta` (shown as +5) | "A small step up" is `marginal`. "We've seen enough of him" is `certainty = adequate` (shown today as "read firm"), which is about the *candidate's* evidence: scouting and results, past the too-early line, nothing unseen. `limited` becomes "though it's an early read on him"; `thin` becomes "but we've barely seen him". ⚑ The card shows +5 while the bars show 43 and 39. The served delta must equal the difference of the served, rounded values, or the words never show both. |
| Season line | `performance.lines`, `sample` 39, `sampleUnit` | Served as a slash line when AVG, OBP and SLG are known. A missing stat drops out ("AVG not known · OBP not known…" in the catcher fixture becomes "No hitting line yet in 41 plate appearances"). |
| Starts at the position | `usage` (an English string today) | ⚑ Typed: `{ starts: 3, innings: 27, errors: 0, position: 7 }`. That also removes "1 games" and "at left fielder". |
| Expected wOBA from tools | `toolsExpected` −0.013 | Why? only. |
| Blend | `weightOnResults` 0.43 | Why? only. |
| ⚑ Weakest core tool | `weakestCore` 18, a percentile (`weakestCorePercentile`) | Which tool it is isn't served. Without a name it's a number with no meaning, so it's left off the card until it's named. |
| Player Development's answer | the candidate's judgement and path ("Can be done now") | ⚑ A typed answer: `defensible` / `defensible_short_only` / `indeterminate` / `poor_fit`, with the duration context. Today the card shows a display string. |

### Must stay true

- **No ranking by a hidden score** (D-024, D-034). The verdict is a stated comparison against one man, on one stated read, with its certainty. The numbers behind it are in *Why?*.
- **"Can't say yet" stays "can't say yet"** (D-018). For Ryan Waldschmidt ("Results: No evidence") the card says "No big-league results yet, so we can only go on the scouts." It never says "step down".
- **Player Development's word is Player Development's** (D-019). The card reports its answer and adds nothing to it.
- **Nothing here is an order.** A step up is a description, not "the pick".

---

## 3. "Every way to clear a roster spot": the Tawa option card

### Before

Section header:
> **Every way to clear an active-roster spot · Active roster: 26 of 26**
> Active roster: 26 of 26, full. An option or a designation clears an active spot. An option keeps the player on the 40-man, so it does NOT open a 40-man spot. Each player appears once, under the one transaction that applies to him. Nothing is ranked: whom to move is the GM's decision.
> **Routine and reversible (1)** No player is put at risk and the move can be undone.

The card:
> **Tim Tawa** left fielder ● Option eligible — 2 years left
> 1 of 3 option years used and 0 years of service: OOTP allowed an option in every observed case like this. (observed and documented)
> Opens: an active spot.
> Uses an option year (1 left afterward), charged at the first day rollover; a same-day reversal was not charged (observed).
> Stays on the 40-man and can be recalled; OOTP enforced no minimum stay in any observed case. This clears an active spot only: it does not open a 40-man spot.
> Minor-league effect ● able Reno Aces (AAA) stays as it is, by Minor League Operations' own reading.
> Reno Aces has room for him at LF: 1 man holds it and it supports 2.
> LF cover: 5 graded → 6 graded
> Active roster: 29 players (14 P) → 30 players (14 P)
> ● Roster note 3 other player(s) on this club (Adrian Del Castillo, Merrill Kelly, Tyler Locklear) may be on rehab; they are counted, so its depth may be overstated.
> MLB service: 0 yr 164 d · Contract: Major-league contract · Options: 1 of 3 used, 2 left
>
> Pennant lists options and their consequences. It does not rank them or make the move: that decision is yours as GM.

### After

Section header:
> **Ways to open a spot**
> The active roster is full at 26. Nothing here is ranked; who goes is your call.
> **Easy to undo (1)** Nobody's put at risk, and you can reverse it.

The card:
> **Optioning Tim Tawa to Reno** ● Allowed
> Opens an active spot. He stays on the 40-man and can come back up any time.
> Uses one of his option years; he'd have 1 left.
> Reno has room for him in left.
>
> ▸ Why?

### Why?

> **Why it's allowed.** He's used 1 of his 3 option years and has less than a year of service. OOTP has allowed an option every time we've seen a case like this, and the manual agrees.
> **When the option year counts.** At the first day rollover after he leaves the active roster. Sending him down and back the same day didn't use one when we tested it.
> **Coming back up.** No minimum stay; OOTP never enforced one in anything we've seen.
> **The 40-man.** This opens an active spot only. He keeps his 40-man spot.
> **Reno.** Their left field has one regular and room for two, so Tawa fits without bumping anyone. Reno's staff see no problem with it. Their roster would go from 29 to 30, still with 14 pitchers. Players who can cover left: 5 now, 6 with him.
> **One caution on Reno's count.** Three players there, Adrian Del Castillo, Merrill Kelly and Tyler Locklear, may be on rehab. They're counted, so Reno's depth may be a little thinner than it looks.
> **His contract.** Major-league deal; 164 days of big-league service.

### Facts needed

| Fact | Field today | Notes |
|---|---|---|
| The action and its answer | Player Rights' `option` evaluation: `eligible`, its basis `observed_and_documented` | "Allowed", "Not allowed", "Not known yet" (never "indeterminate"). |
| ⚑ Rights reasons as typed facts | `reasons: string[]` (English in `playerRights.ts`) | `{ kind: 'option_years', used: 1, of: 3, serviceYears: 0, basis: 'observed_and_documented' }`, `{ kind: 'option_charge', when: 'first_rollover', sameDayCharged: false }`, `{ kind: 'no_minimum_stay' }`. The basis words ("every time we've seen", "the manual agrees", "when we tested it") are the phrasebook's, one per basis code. |
| Option years after | `optionYearsLeft` 2 → 1 | |
| Destination | Reno Aces, level AAA | The short name ("Reno") comes from the phrasebook's club-name rule (the city or nickname the save uses), with the full name in *Why?*. |
| Farm consequence | `farmConsequence` for Reno: `able`, room at LF (`claimants` 1, `capacity` 2), cover 5 → 6, roster 29 → 30, pitchers 14 → 14 | ⚑ The "room" sentence and the rehab note are English in `farmConsequence.ts` and `mlbEvidence.ts` ("1 man holds it", "3 other player(s)"). They need typed facts: `{ kind: 'room_at_position', holders: 1, capacity: 2, position: 7 }`, `{ kind: 'maybe_on_rehab', names: [...] }`. |
| Service and contract | `service` 0 yr 164 d, contract kind `major` | |
| Tier | `routine` ("Routine and reversible") | The tier's name becomes "Easy to undo"; its rule doesn't change. |
| Card title | the plan's action and destination | Said as "Optioning Tim Tawa to Reno", never "Option Tim Tawa to Reno": a move is never worded as a command, even as a title. |
| Active roster | 26 of 26 | Said once, in the header. |

### Must stay true

- **Rights come only from Player Rights, with their basis** (D-023). "Allowed" is Player Rights' `eligible`; observed versus documented is still said in *Why?*, in words.
- **The two roster spots stay separate** (D-028). The card still says the 40-man spot isn't opened.
- **The farm's side is the farm's** (D-045). "Reno's staff see no problem" is Minor League Operations' own `able`, shown, not re-judged.
- **Nothing ranked, nothing executed** (D-004, D-038). The header says so in one line; the old footnote isn't needed.
- **The rehab caution stays.** Unknown placement is never resolved into a fact (D-020, D-026).

---

## 4. Data status: "Transaction history unavailable"

### What makes the history available (from the server code)

Pennant reads OOTP's transaction log from a file OOTP writes inside the save's own folder: `<save>.lg/temp/text_data.sqlite3`, plus its `-wal` while the game runs (`server/ootpSave.ts`). Pennant only ever reads a private copy (`server/liveLogSnapshot.ts`, D-021). The save itself is found from where the export lives (`<save>.lg/import_export/csv`). Pennant looks for the log's files at start, when a save is chosen, when an import lands, and once a minute (`relocateLiveLog`, `frontOfficeService.ts`). The Front Office's builds are keyed on the log's size and time, so a log that appears or changes is picked up **without a new import**.

The reasons it can be unavailable (`dataStatus.ts`, `liveLogSnapshot.ts`), and so the fixes:

| Reason code | What it means | The human fix |
|---|---|---|
| `database_missing` (not_found) | The save was found, but the log file isn't in its `temp` folder. | Open the save in OOTP. Once OOTP writes the log, Pennant picks it up within a minute. |
| `save_not_found` | Pennant can't tell which save the export came from. | Choose your save in Settings. |
| `torn` | OOTP was writing to the log while Pennant copied it. | Nothing; it tries again shortly. |
| `invalid` | The copy isn't a database Pennant can read, or it lacks the tables. | Nothing Pennant can fix; the details are in *Why?*. |
| `copy_failed` | The file couldn't be read (permissions, I/O). | It tries again each minute; the reader's message is in *Why?*. |

What the code doesn't establish: exactly when OOTP creates the file. The research record says the file lingers in a closed save's `temp` folder and was present after loading a copied save, but nothing tested a save that had never been opened. So the fix says "once OOTP writes the log", never "OOTP will create it". (No experiment is asked of the owner; this stays as stated.)

### Before (the owner's screenshot)

> **Data status**
> ⚠ **Transaction history unavailable**
> League data ✓ Current
> Transactions ⚠ Unavailable
> OOTP save 👁 Through May 15, 2026
> Ratings 👁 True ratings
> Roster evidence ⚠ Transaction history unavailable
> Game date May 16, 2026
> Imported data through May 15, 2026
> Save through May 15, 2026
> Exported Sep 19, 2026, 4:37 PM
> Imported Sep 28, 2026, 5:22 PM
> Save folder …/saved_games/your save.lg

### After (the `database_missing` case)

> ⚠ **We can't see your transaction log yet.**
> Everything else is current through May 15. Pennant can still read today's roster, but without the log it can't always tell how a player got there, so a few moves, like recalls, show as "not known".
> **To fix it:** open *your save* in OOTP. Once OOTP writes the log, Pennant picks it up within a minute. There's nothing to import.
>
> League data ✓ Current through May 15 (game day May 16)
> Transaction log ⚠ Not found in the save
> Ratings: OOTP's true ratings, as exported
> Last export: Sep 19, 4:37 PM · imported Sep 28, 5:22 PM
>
> ▸ Why?

Other reasons, same shape:
- `save_not_found`: "**We can't tell which save this export came from.** Your league data is fine; only the transaction log needs the save. *To fix it:* choose your save in Settings."
- `torn`: "**OOTP was busy with the log when we looked.** We'll try again in a minute. Nothing to do."
- `invalid` / `copy_failed`: "**We found the log but couldn't read it.** Your league data is fine. We'll keep trying; what the reader said is under *Why?*."

### Why?

> **Where the log lives.** In the save's folder, at `temp/text_data.sqlite3`. Pennant reads a copy and never touches OOTP's file.
> **What we found.** The save, at …/saved_games/your save.lg (found from where your export lives). No log file in its `temp` folder.
> **What the log adds.** The order things happened in. The export says where everyone is now; the log says how they got there. A rehab assignment and an option look the same in the export, so a recall needs the log.
> **Dates.** Game date May 16, 2026. Your import and the save both run through May 15, 2026.
> **Ratings.** The export's main tables carry OOTP's true ratings. *(The existing hover, unchanged.)*

### Facts needed

| Fact | Field today | Notes |
|---|---|---|
| Level and the log's state | `freshness.level = partial`, `freshness.log.state = unavailable` | |
| Why | `transactionLog.error.code`, `freshness.log.unavailableReason` | All five codes exist. |
| Save name and how it was found | `save.found`, `save.discovery = csv_layout`, `save.path` | ⚑ The save's display name ("your save") as its own field. Today only the path is served, and folder paths are banned from the face (`FOLDER_PATHS`). |
| Dates | `csv.currentDate`, `csv.simulatedThrough`, `save.simulatedThrough`, `csv.exportedAt`, `csv.importedAt` | Three equal dates collapse into one line when they agree. They're still served separately for the *Why?*. |
| How often it looks again | the minute's look (`relocateLiveLog`) | ⚑ Not served. The words say "within a minute" only if that interval is served as a fact, so a later change to the timer can't make the sentence wrong. |
| What the log is for | D-023's "recall needs a current log" | Static content, written once in the phrasebook. |

### Must stay true

- **Never write to OOTP** (D-021). The fix asks the GM to open the save in OOTP, which is his own action in his own game. Pennant still only reads a copy.
- **No owner experiments.** When the file is created stays unstated.
- **Normal use needs only the export** (D-021). "There's nothing to import" is true because the builds are keyed on the log's files.
- **Unknown stays unknown.** A missing log makes some rights "not known", never "not allowed".

---

## 5. The roster map popover (G. Moreno) and its legend

### Before (the owner's screenshot)

> **C G. Moreno** ▮▮▮▮▮▮▮ *(seven pips)*
> *(range bar)* **1.2 wins** T-13th of 30
> AGAINST THE OTHER CLUBS Not separable from the other 29
> BEHIND HIM J. McCann, F. Artiga
> FARM'S NEXT MAN A. Del Castillo · Triple-A · not ready yet

The legend, under the map:
> Range: his expected wins this season, most likely marked · hatched: not valued yet
> Pips: seasons we control him
> Ring and word: a need Major League Ops raised
> Hover for more; click for the basis

(In the screenshot the legend draws through the popover. That's a layout bug for the Mac app, not a wording one.)

### After

> **G. Moreno, catcher** ▮▮▮▮▮▮▮
> *(range bar)* About 1.2 wins this season
> Right in the pack: we can't tell him apart from any other club's catcher.
> Backing him up: J. McCann, F. Artiga
> Next from the farm: A. Del Castillo (Triple-A), not ready yet

The legend:
> ▬ Expected wins this season; the dot is the most likely · striped: not valued yet
> ▮ Seasons he's ours
> ◯ Major League Ops flagged this spot
> Hover for more, click for why.

### Why? (the click)

> **His value.** About 1.2 wins over the rest of this season, most likely. Four times in five he lands between {low} and {high}.
> **Against the league.** Tied for 13th of 30 catchers on the most likely number, but the ranges overlap with every other club's, so the place doesn't separate him from anyone. *(This is where "T-13th of 30" goes: once, with what it means.)*
> **How clubs are compared.** Two catchers are only called different when the ranges they land in half the time don't meet.
> **Behind him.** J. McCann ({wins}), F. Artiga (not valued yet).
> **The farm's next man.** A. Del Castillo at Triple-A, the readiest at catcher by Player Development's read. Not ready yet: {blockers}.
> **Control.** {control.text}. *(The pips are the seasons left in that.)*
> **Why Moreno.** He has the most starts at catcher this season among the men who've caught in the last 15 games. Every club's man is picked the same way.

### Facts needed

| Fact | Field today | Notes |
|---|---|---|
| Holder, position | `holder`, `pos` | Position as a word ("catcher"), from the position table. |
| Wins and range | `holder.wins.likely` 1.2, `low`/`high`, `inner` | |
| Place and separation | `place` (13 of 30, tied), `clearlyAhead` 0, `overlap` 29, `clearlyBehind` 0 | The phrasebook selects on the three counts: all level is "right in the pack: we can't tell him apart…"; some ahead and some level is "ahead of {a}, level with the rest"; and so on. The rank goes to *Why?* when nothing separates him, so the face never shows a rank the ranges don't support. |
| Behind him | `behind[]` with wins or null | |
| Farm's next man | `farmNext` name, level, readiness state `notYet`, blockers | ⚑ The blockers are English strings from Player Development (`assessment.blockers`). They need typed reasons. |
| Control | `control.kind`, `through`, `seasonsLeft` 7 | |
| Need ring | `needs[]` | |

### Must stay true

- **No composite score, and places stated with their overlap** (D-057). "Right in the pack" is said *because* the ranges overlap with all 29. A place the ranges don't separate is never shown as a bare rank.
- **Unvalued stays unvalued.** Striped, "not valued yet", never placed (D-052, D-057).
- **The farm's readiness is Player Development's** (D-019), shown and not re-judged.
- **The unit stays expected wins.** No dollars, so contracts aren't ranked (D-057).

---

## 6. A Morning Report desk item and a department card

### 6a. The desk item

**Before** (the real save's Tawa need, worded by `needText` in `presentation/frontOffice/majorLeague.ts`; the coach's name is the save's):
> **The staff flagged Tim Tawa's work as a left fielder** *(hover: "A flag to look at, not a move")*
> Raised by {coach}, bench coach · Strong case · Open

**After:**
> **Tim Tawa isn't hitting enough to hold left field.**
> Small sample so far; the staff would keep watching. · {coach}, bench coach

The same sentence opens the decision page (sample 1), so the GM recognises it when he clicks through. The widget and the menu bar take the short form of the same message: "Tawa isn't hitting enough for left".

**Why?** (the hover): "From the scouting review. Click for the full read and your options."

### 6b. The department card

**Before** (Major League Ops, from the served fixture `getFrontOffice.json`; the synthetic save):
> **Major League Ops** · Prepared by Rafael Dunn, bench coach
> One to decide; one to watch.
> Active roster 26 of 26 · 40-man roster 32 of 40 · On the injured list 0
> No backup on the bench for second baseman · Noted · Open

**After:**
> **Major League Ops** · Rafael Dunn, bench coach
> One thing to decide, one to keep an eye on: nobody on the bench is known to play second.
> Roster full (26) · 32 on the 40-man · nobody on the IL

Three lines: who, what needs you, and the shape of the roster. "Known to play" keeps today's "visibly": a bench player with no rating at second isn't said to be unable to play there (D-018). "Noted" and "Open" go to the hover; the card's own colour already says how urgent it is.

**Why?** (the hover on each figure): "Active roster: 26 of 26." "40-man: 32 of 40, so 8 spots open." "Injured list: nobody."

### Facts needed

| Fact | Field today | Notes |
|---|---|---|
| Desk item: the need and its review | `need.kind = role_holder_review`, `need.review`, `recommendation.code` | The desk calls the *same* message key as the decision page's headline, with the same facts. ⚑ It needs `weakPart` (sample 1). |
| Raised by | `raisedBy` (the staff member and role) | |
| Short form | — | ⚑ A `short` variant per message for the widget, the menu bar and Spotlight (D-075). Same facts, fewer words. |
| Card counts | `toDecide` 1, `watching` 1, `top[0]` | "One thing to decide…: {top item}" joins the summary and the top item into one sentence. That needs the top item's message, not its display string. |
| Figures | active 26/26, 40-man 32/40, IL 0 | "Roster full" is said only when count equals limit, from served numbers. |

### Must stay true

- **The desk records attention and decides nothing** (D-058). The status ("Open") stays a control, not a sentence.
- **Order and membership are the department's philosophy-free severity** (D-060). Rewording changes neither.
- **No odds, posture or window labels** on the desk, the card, the widget or the menu bar (D-060, D-075).
- **"Nothing to decide" is never an all-clear** for a department that couldn't be read. The existing "Nothing to decide from the six departments reporting" rule keeps its meaning in the new words.

---

## Open questions these samples raise

1. **"Over 293 plate appearances."** The 293 is an effective, recency-weighted sample across seasons, not a count of his plate appearances. Should the code serve the raw count (recommended), or should the sentence say "about 293 plate appearances, recent ones counting most"?
2. **"His glove is among the best there."** That's the scouts' grade (better than 94% of big-leaguers in left). His glove as the read actually weighs it, grade plus 325 innings of results, is 84: "well above average", not "among the best". Which should the sentence describe? The draft uses the scouts' grade on the face and gives both in *Why?*.
3. **"Bottom 5%" or "near the bottom".** The approved sample says "near the bottom", which today's facts support. A precise "bottom 5% of everyday left fielders" needs a new fact: his actual place among the league's regular left fielders.
4. **20–80 grades.** Where the export uses the 20–80 scale, may the face say "a 70 glove", the way scouts talk? (It would follow D-061's "as the export gives them".)
