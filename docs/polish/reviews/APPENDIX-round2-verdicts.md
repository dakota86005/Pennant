# Round 2: every finding and its verdict

## Appendix: every round-2 finding

| Finding | Sev | Claimed | Verdict | Item | Plain title |
|---|---|---|---|---|---|
| SRVINFRA-01 | H | PROVEN | CONFIRMED | B-57 | After you pick another save, players in the league on screen pick up that save's moves, dates and name |
| SRVINFRA-02 | H | PROVEN | CONFIRMED | B-58 | If anything goes wrong right after an import, Pennant says it failed but already shows the new data with old leftovers |
| SRVINFRA-03 | H | PROVEN | CONFIRMED | B-58 | A half-written settings file quietly resets, and the next save wipes philosophies, budgets and themes |
| SRVINFRA-04 | H | PROVEN | CONFIRMED | B-57 | Switch saves and quit before it imports, and the new save follows the old save's club |
| SRVINFRA-05 | H | PROVEN | CONFIRMED | B-61 | Batted-ball league averages stay from the first import until restart |
| SRVINFRA-06 | H | PROVEN | CONFIRMED | B-58 | A broken export with an empty players file replaces a good league with an empty one |
| SRVINFRA-07 | H | PROVEN | CONFIRMED | B-74 | On the old desktop app and dev server, any website can start paid AI writing, imports and site exports |
| SRVINFRA-08 | M | CONFIRMED | CONFIRMED | B-59 | Philosophy, budget and theme carry over to the club with the same number in another save |
| SRVINFRA-09 | M | CONFIRMED | CONFIRMED | B-59 | Briefing, storylines and Staff room chats from another save show up and go to the AI |
| SRVINFRA-10 | M | PROVEN | PLAUSIBLE | B-102 | Running from source on an older Node quietly skips background work and per-save refits |
| SRVINFRA-11 | M | CONFIRMED | CONFIRMED | B-93 | One failed page build moves all later builds onto the main thread for good |
| SRVINFRA-12 | M | PROVEN | CONFIRMED | B-59 | Renaming the league or losing an old player makes Pennant treat the save as new and lose its fitted history |
| SRVINFRA-13 | M | PROVEN | CONFIRMED | B-83 | Names with accents, curly quotes or the euro sign come in garbled and don't match the transaction log |
| SRVINFRA-14 | M | PROVEN | CONFIRMED | B-82 | An export whose file times are in the future is never imported, and the error blames OOTP |
| SRVINFRA-15 | M | CONFIRMED | CONFIRMED | B-82 | A stuck import can't be stopped without quitting |
| SRVINFRA-16 | M | CONFIRMED | CONFIRMED | B-82 | After a crash and reboot Pennant may refuse to start; two copies starting together can both run |
| SRVINFRA-17 | M | CONFIRMED | CONFIRMED | B-82 | A failed import is retried at every launch and called "interrupted" |
| SRVINFRA-18 | M | CONFIRMED | CONFIRMED | B-94 | Reading the game's log can freeze the app for seconds on long saves |
| SRVINFRA-19 | M | CONFIRMED | CONFIRMED | B-57 | A save folder picked by hand is ignored, yet Settings shows it as in use |
| SRVINFRA-20 | M | PROVEN | CONFIRMED | B-84 | A hurt player with no roster-status row is missing from the Injury Report |
| SRVINFRA-21 | M | PROVEN | CONFIRMED | B-82 | Numbers are stored as decimals, so fallback names read "Club 3.0" |
| SRVINFRA-22 | L | CONFIRMED | UNCHECKED | B-94 | The once-a-minute save check sometimes scans every save |
| SRVINFRA-23 | L | CONFIRMED | CONFIRMED | B-85 | A player's trade and injury history can be out of order or fail on some exports |
| SRVINFRA-24 | L | CONFIRMED | CONFIRMED | B-82 | A refused import throws away a refit that was running |
| SRVINFRA-25 | L | CONFIRMED | CONFIRMED | B-57 | Picking a save turns export watching on even when it was switched off |
| SRVINFRA-26 | L | CONFIRMED | CONFIRMED | B-81 | Automatic AI writing after an import can be about the wrong club |
| SRVINFRA-27 | L | CONFIRMED | CONFIRMED | B-79 | AI features default to the most expensive model |
| SRVINFRA-28 | L | CONFIRMED | CONFIRMED | B-101 | A Windows-style settings file breaks keys, and one in the data folder can flip test-only switches |
| SRVINFRA-29 | L | CONFIRMED | CONFIRMED | B-104 | An old config file is read forever, and an unused setting lingers |
| SRVINFRA-30 | L | CONFIRMED | UNCHECKED | B-103 | Team logos can fail, go missing, or stay old for a day |
| SRVINFRA-31 | L | CONFIRMED | CONFIRMED | B-103 | The website export leaks folder paths and can overwrite an earlier export |
| SRVINFRA-32 | L | CONFIRMED | UNCHECKED | B-94 | Imports load whole files into memory |
| SRVINFRA-33 | L | PROVEN | UNCHECKED | B-93 | Every page build starts a fresh background helper |
| SRVINFRA-34 | L | CONFIRMED | CONFIRMED | B-80 | Restarting after an unfinished import can pay for AI writing again |
| SRVINFRA-35 | L | CONFIRMED | UNCHECKED | B-99 | Several promises in code comments have no test behind them |
| SRVINFRA-36 | L | SUSPECTED | UNCHECKED | B-58 | A league rebuilt in the same folder may keep old leftover tables |
| SRVPRES-01 | H | PROVEN | PROVEN | B-60 | Without the transaction log, the Front Office never notices you simmed past the export |
| SRVPRES-02 | M | PROVEN | PROVEN | B-60 | Org Comparison keeps an old "up to date" build after the export falls behind |
| SRVPRES-03 | M | PROVEN | PROVEN | B-61 | Changing any setting, even a colour theme, rebuilds every department |
| SRVPRES-04 | M | PROVEN | PROVEN | B-92 | One farm problem blanks all five farm pages, and every click redoes the whole farm |
| SRVPRES-05 | M | PROVEN | PROVEN | B-95 | Player Search sorted by a stat slows sharply as the league grows |
| SRVPRES-06 | M | PROVEN | PROVEN | B-01 | The check that keeps code words off screen skips most hover text |
| SRVPRES-07 | M | CONFIRMED | CONFIRMED | B-13 | Payroll room shows a firm "$X free" while some salaries are missing |
| SRVPRES-08 | L | CONFIRMED | UNCHECKED | B-22 | The farm's lines table sorts by hidden values, not what it shows |
| SRVPRES-09 | L | CONFIRMED | CONFIRMED | B-68 | A player's "this season" line can show only part of a traded player's season |
| SRVPRES-10 | L | CONFIRMED | CONFIRMED | B-02 | Unknown standings and innings are shown as zero or "none" |
| SRVPRES-11 | L | CONFIRMED | CONFIRMED | B-85 | The Draft Board compares dates its own way |
| SRVPRES-12 | L | CONFIRMED | CONFIRMED | B-99 | About 34 sample server answers are never checked by the Mac app's tests |
| SRVPRES-13 | L | CONFIRMED | CONFIRMED | B-61 | A farm decision made during an import can mix old and new data and be kept |
| SRVPRES-14 | L | CONFIRMED | CONFIRMED | B-75 | Raw internal error messages can reach the app |
| SRVPRES-15 | L | CONFIRMED | CONFIRMED | B-32 | Next season's expected budget is applied to the years after it too |
| SRVPRES-16 | L | CONFIRMED | CONFIRMED | B-21 | Trade analysis doesn't wait for a league upgrade to finish |
| SRVPRES-17 | L | SUSPECTED | UNCHECKED | B-93 | Every answer is re-checked and re-packed on each request |
| SRVSTATS-01 | H | PROVEN | PROVEN | B-66 | The Trade Desk shows true fielding grades instead of our scouts' |
| SRVSTATS-02 | H | PROVEN | PROVEN | B-68 | League Leaders leave out anyone sent down, released or moved to another league |
| SRVSTATS-03 | M | PROVEN | PROVEN | B-95 | Player Search sorted by a stat gets very slow, then fails on big leagues |
| SRVSTATS-04 | M | PROVEN | PROVEN | B-70 | One pitcher's FIP differs between Rosters and the pitching staff |
| SRVSTATS-05 | M | PROVEN | PROVEN | B-70 | A pitcher with a 0.00 ERA sorts last and reads as unknown form |
| SRVSTATS-06 | M | PROVEN | PROVEN | B-68 | The Trade Desk adds a player's minor and major league seasons together |
| SRVSTATS-07 | M | PROVEN | PROVEN | B-68 | The Game Plan credits at-bats to a pitcher's new club |
| SRVSTATS-08 | M | PROVEN | PROVEN | B-91 | Openers and stretched relievers vanish from the rotation |
| SRVSTATS-09 | M | PROVEN | PROVEN | B-85 | The newest injury can drop off the player card |
| SRVSTATS-10 | M | CONFIRMED | CONFIRMED | B-59 | Staff notes can show up on a different player in another save |
| SRVSTATS-11 | M | SUSPECTED | CONFIRMED | B-66 | Quick Open can show draft prospects OOTP hasn't revealed yet |
| SRVSTATS-12 | M | CONFIRMED | CONFIRMED | B-86 | Pages disagree on which season is "this season" around the rollover |
| SRVSTATS-13 | M | CONFIRMED | CONFIRMED | B-64 | A player with no at-bats is treated as exactly average in the lineup order |
| SRVSTATS-14 | M | SUSPECTED | CONFIRMED | B-94 | The news wire rereads all trade and injury history every time |
| SRVSTATS-15 | M | SUSPECTED | CONFIRMED | B-92 | MLB reports redo the whole prospect assessment many times |
| SRVSTATS-16 | M | CONFIRMED | CONFIRMED | B-21 | Trade partners come from major leagues you can't trade with |
| SRVSTATS-17 | L | CONFIRMED | CONFIRMED | B-68 | Player Search can show a school season as a player's main stint |
| SRVSTATS-18 | L | CONFIRMED | UNCHECKED | B-02 | Standings says there's no wild card when the data is just missing |
| SRVSTATS-19 | L | CONFIRMED | UNCHECKED | B-02 | Development reads missing pitching stats as zero |
| SRVSTATS-20 | L | CONFIRMED | UNCHECKED | B-65 | An unknown pitch ceiling is shown as his current grade |
| SRVSTATS-21 | L | CONFIRMED | UNCHECKED | B-65 | Rating history averages around missing tools |
| SRVSTATS-22 | L | CONFIRMED | UNCHECKED | B-63 | The AI is told an unknown budget is zero |
| SRVSTATS-23 | L | CONFIRMED | UNCHECKED | B-86 | The season falls back to the computer's calendar year |
| SRVSTATS-24 | L | SUSPECTED | UNCHECKED | B-81 | Leagues with several human managers mix up inboxes |
| SRVSTATS-25 | L | CONFIRMED | CONFIRMED | B-70 | A tied game counts as a loss |
| SRVSTATS-26 | L | CONFIRMED | CONFIRMED | B-101 | Part of the AI key is saved in a plain file |
| SRVSTATS-27 | L | CONFIRMED | CONFIRMED | B-84 | A missing column crashes stat pages and the draft board |
| SRVSTATS-28 | L | CONFIRMED | UNCHECKED | B-02 | The trading block shows "0.00 ERA" when the ERA is unknown |
| SRVSTATS-29 | L | CONFIRMED | CONFIRMED | B-75 | An odd sort setting crashes the old player list |
| SRVSTATS-30 | L | CONFIRMED | UNCHECKED | B-104 | Duplicate lookup tables disagree; some code is unused |
| SRVSTATS-31 | L | SUSPECTED | PLAUSIBLE | B-83 | Fixing accented names could make a league lose its own rating history |
| SRVSTATS-32 | M | CONFIRMED | CONFIRMED | B-70 | The stat formulas have no tests |
| SRVVALUE-01 | M | PROVEN | PROVEN | B-61 | Pages keep the previous import's market price for a whole import |
| SRVVALUE-02 | H | PROVEN | PROVEN | B-60 | When the export is a day behind, players lose their dollar values while Finance still prices a win |
| SRVVALUE-03 | H | PROVEN | PROVEN | B-72 | Contracts leaves out big-league-contract players sent to the minors |
| SRVVALUE-04 | M | PROVEN | PROVEN | B-73 | After reloading an older save, the abandoned timeline still counts in the market price |
| SRVVALUE-05 | M | CONFIRMED | CONFIRMED | B-88 | A free agent's market figure can fall below the league minimum, even below zero |
| SRVVALUE-06 | M | CONFIRMED | CONFIRMED | B-94 | The market history grows each import and is read in full on every Finance load |
| SRVVALUE-07 | L | CONFIRMED | UNCHECKED | B-99 | A safety test checks the wrong place where the market record is written |
| SRVVALUE-08 | L | CONFIRMED | CONFIRMED | B-105 | In leagues whose top level isn't level 1, some contract years read unknown |
| SRVVALUE-09 | L | CONFIRMED | CONFIRMED | B-105 | The value-of-a-win explanation assumes a 162-game season |
| SRVVALUE-10 | L | CONFIRMED | CONFIRMED | B-62 | The old web pages show playoff odds outside Standings |
| SRVVALUE-11 | L | CONFIRMED | CONFIRMED | B-103 | An unused value address ignores how fresh the data is |
| SRVVALUE-12 | L | CONFIRMED | CONFIRMED | B-72 | Contracts fails outright on an export missing a table |
| SRVVALUE-13 | L | CONFIRMED | CONFIRMED | B-06 | Small money and wording slips ("$1000K", "pre arbitration") |
| SRVVALUE-14 | L | SUSPECTED | UNCHECKED | B-61 | A league-facts cache could lock in the wrong season |
| SRVAI-01 | H | PROVEN | PROVEN | B-76 | Long Staff room conversations keep growing until every question fails |
| SRVAI-02 | H | CONFIRMED | CONFIRMED | B-62 | The AI assistants can look up and repeat postseason odds and buy/sell advice |
| SRVAI-03 | M | PROVEN | PROVEN | B-77 | The trade desk keeps working, and charging, after the app gave up waiting |
| SRVAI-04 | M | PROVEN | PROVEN | B-78 | When the AI runs out of lookups it hands back a blank answer as if done |
| SRVAI-05 | M | PROVEN | PROVEN | B-78 | An AI answer cut off mid-sentence is shown and saved as finished |
| SRVAI-06 | M | PROVEN | PROVEN | B-76 | After about 20 questions the Staff room forgets what it already looked up |
| SRVAI-07 | M | CONFIRMED | CONFIRMED | B-63 | The storylines writer is told to give promotion opinions with no guardrails |
| SRVAI-08 | M | CONFIRMED | CONFIRMED | B-81 | With more than one human club, the assistant may read another club's standings and contracts |
| SRVAI-09 | M | CONFIRMED | CONFIRMED | B-63 | The AI is told the prospect list is ranked when it is alphabetical |
| SRVAI-10 | M | CONFIRMED | CONFIRMED | B-77 | AI writing and key checks can hang for minutes with no way to stop them |
| SRVAI-11 | M | SUSPECTED | PLAUSIBLE | B-79 | On a local Ollama model, big conversations may be silently cut |
| SRVAI-12 | M | SUSPECTED | PLAUSIBLE | B-79 | Newer Claude models may refuse Staff room follow-ups; the model list is out of date |
| SRVAI-13 | L | CONFIRMED | UNCHECKED | B-77 | The Staff room goes silent between lookups on the newest models |
| SRVAI-14 | L | CONFIRMED | CONFIRMED | B-78 | When a non-Claude AI declines, the Staff room doesn't say so |
| SRVAI-15 | L | CONFIRMED | CONFIRMED | B-02 | When games-back is unknown, staff voices say the club leads the division |
| SRVAI-16 | L | CONFIRMED | UNCHECKED | B-84 | Briefing and storylines break on exports missing two columns; spring games count as form |
| SRVAI-17 | L | CONFIRMED | CONFIRMED | B-101 | Part of the AI key is saved on disk in plain text |
| SRVAI-18 | L | CONFIRMED | CONFIRMED | B-79 | New Gemini users' first request fails |
| SRVAI-19 | L | CONFIRMED | CONFIRMED | B-79 | Every Staff room question retries a failing model-list lookup first |
| SRVAI-20 | L | CONFIRMED | CONFIRMED | B-78 | The key check says a Zen key works when the service is down |
| SRVAI-21 | L | CONFIRMED | CONFIRMED | B-79 | The old chat names Anthropic even when another provider lacks a key |
| SRVAI-22 | L | CONFIRMED | PLAUSIBLE | B-80 | Auto-writing after imports pays for two AI writes on every daily export |
| SRVAI-23 | L | SUSPECTED | UNCHECKED | B-78 | Gemini lookup ids repeat between questions |
| SRVDEV-01 | H | PROVEN | PROVEN | B-66 | "Show no player ratings" still shows ratings on several pages |
| SRVDEV-02 | H | PROVEN | PROVEN | B-67 | After the rating source changes, old development lines are reused as this save's own |
| SRVDEV-03 | M | PROVEN | PROVEN | B-65 | An unknown age profile makes a struggling player look too advanced |
| SRVDEV-04 | M | PROVEN | PROVEN | B-90 | Changing OOTP's rating scale looks like player growth |
| SRVDEV-05 | M | PROVEN | PROVEN | B-84 | An export without a ratings table crashes the pitching staff and draft board |
| SRVDEV-06 | M | PROVEN | PROVEN | B-66 | The scouting-only safety check misses much of the server |
| SRVDEV-07 | M | PROVEN | PROVEN | B-92 | Some pages reload all rating history repeatedly (3 s at 300,000 rows) |
| SRVDEV-08 | M | CONFIRMED | CONFIRMED | B-34 | Grades are called "your scouts'" even when they're true or OSA ratings |
| SRVDEV-09 | L | SUSPECTED | UNCHECKED | B-66 | When the export type is unknown, true ratings may beat OSA's |
| SRVDEV-10 | L | CONFIRMED | CONFIRMED | B-106 | The card says "not optioned" for a player optioned today |
| SRVDEV-11 | L | CONFIRMED | CONFIRMED | B-84 | A looping club hierarchy would hang the server |
| SRVDEV-12 | L | CONFIRMED | UNCHECKED | B-02 | Unknown age shows as 0 and unknown injury status as "not injured" |
| SRVDEV-13 | L | CONFIRMED | UNCHECKED | B-92 | Roster snapshots reread full history for each change |
| SRVDEV-14 | L | CONFIRMED | UNCHECKED | B-106 | A missing row is blamed on OOTP |
| SRVDEV-15 | L | SUSPECTED | PLAUSIBLE | B-65 | Philosophy can prefer "stay" where Development says he has outgrown the level |
| SRVFARM-01 | H | PROVEN | PROVEN | B-70 | Strikeout pitchers in hitters' parks are rated worse, not better |
| SRVFARM-02 | H | PROVEN | PROVEN | B-12 | Players nothing was learned about are shown as getting "Regular work" |
| SRVFARM-03 | H | PROVEN | PROVEN | B-71 | Big-leaguers on rehab are reviewed and counted as farm players |
| SRVFARM-04 | H | PROVEN | PROVEN | B-71 | The farm says nobody can play shortstop when a listed shortstop is there |
| SRVFARM-05 | M | PROVEN | PROVEN | B-87 | A player back from a long injury looks like he was benched |
| SRVFARM-06 | M | PROVEN | PROVEN | B-69 | Recent-usage reads count spring, playoff and old-season games |
| SRVFARM-07 | M | PROVEN | PROVEN | B-69 | An All-Star appearance makes a player look newly arrived |
| SRVFARM-08 | M | PROVEN | PROVEN | B-84 | Older or unusual saves can break the whole farm section |
| SRVFARM-09 | M | PROVEN | PROVEN | B-92 | The farm does the same heavy work twice per load and many times per import |
| SRVFARM-10 | M | CONFIRMED | CONFIRMED | B-87 | Moving an injured player is blamed for a lineup hole he wasn't filling |
| SRVFARM-11 | M | CONFIRMED | CONFIRMED | B-87 | Organization depth counts injured players as available |
| SRVFARM-12 | M | CONFIRMED | CONFIRMED | B-86 | In the offseason, last season's numbers are read as this season's |
| SRVFARM-13 | M | PROVEN | PROVEN | B-84 | A malformed save could freeze the server |
| SRVFARM-14 | M | CONFIRMED | CONFIRMED | B-87 | An incoming player's summary counts injured men as rivals |
| SRVFARM-15 | L | CONFIRMED | CONFIRMED | B-71 | A designated hitter can be treated as a catcher |
| SRVFARM-16 | L | CONFIRMED | CONFIRMED | B-71 | Room at a level is judged from only one of its clubs |
| SRVFARM-17 | L | CONFIRMED | UNCHECKED | B-65 | Small leagues are told more games will settle a comparison that never can |
| SRVFARM-18 | L | CONFIRMED | CONFIRMED | B-68 | A player who played for two clubs gets one club's park adjustment |
| SRVFARM-19 | L | CONFIRMED | UNCHECKED | B-13 | Farm read failures are hidden or shown as zero |
| SRVFARM-20 | L | CONFIRMED | UNCHECKED | B-87 | Without a game log, a promoted player's move date goes unused |
| SRVFARM-21 | L | CONFIRMED | UNCHECKED | B-99 | Safety tests skip parts of the farm code |
| SRVFARM-22 | L | CONFIRMED | UNCHECKED | B-99 | The farm reads prospect data with no type check |
| SRVFARM-23 | L | CONFIRMED | CONFIRMED | B-63 | The AI is given promotion codes under a label they contradict |
| SRVFARM-24 | L | CONFIRMED | UNCHECKED | B-89 | Farm timing settings were tuned on one save only |
| SRVFARM-25 | L | CONFIRMED | UNCHECKED | B-104 | Leftover dead code and misleading comments in the farm |
| SRVMLB-01 | H | PROVEN | PROVEN | B-68 | "Who plays where" counts a traded player's games for his old club as ours |
| SRVMLB-02 | H | PROVEN | PROVEN | B-69 | Postseason odds count spring training and other non-season games as games left |
| SRVMLB-03 | M | PROVEN | PROVEN | B-62 | With no club philosophy, the odds quietly push the staff's advice and blame the club's window |
| SRVMLB-04 | M | PROVEN | PROVEN | B-64 | A send-down that may use his last option year is called routine |
| SRVMLB-05 | M | PROVEN | PROVEN | B-25 | Ways to clear a roster spot are misfiled |
| SRVMLB-06 | M | PROVEN | PROVEN | B-64 | A player with no visible ratings and poor results is filed as "results lag tools" |
| SRVMLB-07 | M | PROVEN | PROVEN | B-17 | On opening day, or after the rollover, every hitter is "on the bench" |
| SRVMLB-08 | M | PROVEN | PROVEN | B-89 | Small leagues are always told their pitching staff is critically short |
| SRVMLB-09 | M | PROVEN | PROVEN | B-64 | The bench report says "nobody" when the data isn't there, and invents needs |
| SRVMLB-10 | M | CONFIRMED | CONFIRMED | B-67 | Glove weights are adopted as "the league's own" without being clearly better |
| SRVMLB-11 | L | PROVEN | PROVEN | B-67 | A role the save never measured shows the default number as the league's own |
| SRVMLB-12 | L | CONFIRMED | UNCHECKED | B-106 | A blended estimate is called "visible tools" |
| SRVMLB-13 | L | CONFIRMED | CONFIRMED | B-62 | The needs list order is quietly shifted by the odds |
| SRVMLB-14 | L | CONFIRMED | CONFIRMED | B-25 | An unknown roster count is reported as "roster is full" |
| SRVMLB-15 | L | CONFIRMED | CONFIRMED | B-64 | A follow-up names someone "the weakest" when nobody can be compared |
| SRVMLB-16 | L | CONFIRMED | UNCHECKED | B-64 | "Thinnest position" is judged on the backup when the starter is unknown |
| SRVMLB-17 | L | CONFIRMED | CONFIRMED | B-84 | A missing stat column silently stops the league's own standards from ever being measured |
| SRVMLB-18 | L | CONFIRMED | UNCHECKED | B-106 | Plan titles read as orders ("Designate X") |
| SRVMLB-19 | L | SUSPECTED | UNCHECKED | B-92 | Opening one decision rebuilds the whole club review |
| SRVMLB-20 | L | CONFIRMED | UNCHECKED | B-99 | Test data lacks the real export's columns, which hid two bugs |
| SRVMLB-21 | L | CONFIRMED | UNCHECKED | B-91 | Small slips: raw role codes, "of 3 used", an injured "next man up", age off by one |
| SRVHEALTH-01 | H | PROVEN | PROVEN | B-75 | One bad request can crash the app's server, including from Ask Staff |
| SRVHEALTH-02 | M | PROVEN | CONFIRMED | B-76 | Long trade-desk conversations stop working ("request too large") |
| SRVHEALTH-03 | M | PROVEN | PROVEN | B-99 | The farm-to-majors link tests check nothing (the test farm is empty) |
| SRVHEALTH-04 | M | PROVEN | PROVEN | B-99 | Tests are never type-checked and have drifted from the real code (98 errors) |
| SRVHEALTH-05 | M | CONFIRMED | PROVEN | B-06 | Money reads "$-3.2M free" and "$1000K", and pages round differently |
| SRVHEALTH-06 | M | PROVEN | CONFIRMED | B-74 | Old desktop app: reopening from the Dock starts a second server |
| SRVHEALTH-07 | M | CONFIRMED | CONFIRMED | B-74 | Old desktop app ships a version of Electron with known security holes |
| SRVHEALTH-08 | M | CONFIRMED | CONFIRMED | B-100 | Deleting the old web addresses would silently break the AI staff's lookups |
| SRVHEALTH-09 | L | CONFIRMED | CONFIRMED | B-103 | Ten server addresses nothing uses |
| SRVHEALTH-10 | L | CONFIRMED | UNCHECKED | B-103 | The full list of old-web-only addresses to retire |
| SRVHEALTH-11 | L | CONFIRMED | UNCHECKED | B-104 | Unused code, and per-save standards tested only at the defaults |
| SRVHEALTH-12 | L | CONFIRMED | CONFIRMED | B-102 | Known security advisories in libraries (3 critical, 7 high) |
| SRVHEALTH-13 | L | CONFIRMED | UNCHECKED | B-102 | Major libraries are behind and the required Node version isn't declared |
| SRVHEALTH-14 | L | CONFIRMED | UNCHECKED | B-99 | Expected test outputs get rewritten wholesale, so mistakes become "expected" |
| SRVHEALTH-15 | L | CONFIRMED | CONFIRMED | B-104 | Build leftovers could be committed by accident |
| SRVHEALTH-16 | L | CONFIRMED | UNCHECKED | B-74 | Old desktop app: loose checks on its internal bridge |
| SRVHEALTH-17 | L | CONFIRMED | CONFIRMED | B-104 | Leftover owner-experiment scripts; a benchmark script could write into the real data folder |
| SRVHEALTH-18 | L | CONFIRMED | UNCHECKED | B-75 | Server tests skip the real request checks |
| SRVHEALTH-19 | L | CONFIRMED | CONFIRMED | B-06 | Number words copied many times; some say "21th" |
| SRVHEALTH-20 | L | CONFIRMED | CONFIRMED | B-102 | The main checkout's installed libraries are out of date |
| MACUI-01 | H | CONFIRMED | CONFIRMED | B-96 | VoiceOver users never hear the numbers, or a position's "Need" flag |
| MACUI-02 | M | CONFIRMED | CONFIRMED | B-37 | Open or Compare can act on a player the filter has hidden |
| MACUI-03 | M | CONFIRMED | CONFIRMED | B-08 | A failed choice on a Decision leaves only an error, with no way back |
| MACUI-04 | M | PROVEN | CONFIRMED | B-42 | The trade builder offers "All N in Player Search" as if it were a player |
| MACUI-05 | M | CONFIRMED | CONFIRMED | B-37 | The Player menu stays greyed out with a row chosen in most tables |
| MACUI-06 | M | CONFIRMED | CONFIRMED | B-07 | Pinned evidence and the search box's answers stay from the previous save |
| MACUI-07 | M | SUSPECTED | PLAUSIBLE | B-36 | Player Search can lose its search when opened twice in a row |
| MACUI-08 | M | CONFIRMED | CONFIRMED | B-36 | Resizing the window wipes a half-typed trade name or an open section |
| MACUI-09 | L | PROVEN | CONFIRMED | B-104 | A display switch is ignored for good and bad cells (no caller uses it yet) |
| MACUI-10 | L | CONFIRMED | UNCHECKED | B-36 | Open or closed sections carry over to the next row |
| MACUI-11 | L | SUSPECTED | PLAUSIBLE | B-97 | Dragging a philosophy slider can save twice |
| MACUI-12 | L | CONFIRMED | UNCHECKED | B-96 | Some drop-down menus still use the kind VoiceOver struggles with |
| MACUI-13 | L | CONFIRMED | CONFIRMED | B-96 | The chosen farm club is shown only by colour |
| MACUI-14 | L | CONFIRMED | UNCHECKED | B-96 | "Not known" cells go faint on a highlighted row |
| MACUI-15 | L | CONFIRMED | CONFIRMED | B-97 | "Ask Staff About Him" can silently do nothing |
| MACUI-16 | L | CONFIRMED | CONFIRMED | B-36 | Switching batting/pitching history keeps the wrong columns and sort |
| MACUI-17 | L | CONFIRMED | UNCHECKED | B-97 | Trade builder changes (Clear Deal) can't be undone |
| MACUI-18 | L | CONFIRMED | CONFIRMED | B-36 | Every Decision's candidate tables share one column layout |
| MACUI-19 | L | CONFIRMED | CONFIRMED | B-53 | The trade chart's spoken graph uses a number the server never gave |
| MACUI-20 | L | CONFIRMED | UNCHECKED | B-45 | Long Staff room chats do extra work on every word streamed |
| MACUI-21 | L | CONFIRMED | CONFIRMED | B-96 | VoiceOver's desk actions don't match the menus |
| MACUI-22 | L | CONFIRMED | CONFIRMED | B-96 | The Tab key stops on every figure and name, and clicks show focus rings |
| MACUI-23 | L | CONFIRMED | CONFIRMED | B-40 | Settings' club picker can show blank or the wrong club |
| MACKIT-01 | H | CONFIRMED | CONFIRMED | B-77 | The AI desk and Staff room show "couldn't reach the server" on slow answers, after the tokens are paid for |
| MACKIT-02 | M | CONFIRMED | CONFIRMED | B-07 | After a failed save switch, the old save's report stays up as "Updating" |
| MACKIT-03 | H | PROVEN | CONFIRMED | B-07 | A note typed in one save can land on a different player in another save |
| MACKIT-04 | M | PROVEN | CONFIRMED | B-97 | Undoing "Remove Staff Note" breaks Redo, and Cmd-Z removes it again |
| MACKIT-05 | M | PROVEN | CONFIRMED | B-07 | A slow older refresh can put the previous club back |
| MACKIT-06 | L | SUSPECTED | UNCHECKED | B-98 | Updates missed while reconnecting are never caught up |
| MACKIT-07 | L | SUSPECTED | PLAUSIBLE | B-98 | An AI key saved right at launch can be ignored |
| MACKIT-08 | L | CONFIRMED | CONFIRMED | B-97 | Quitting while the server is down loses unsaved notes |
| MACKIT-09 | M | PROVEN | CONFIRMED | B-97 | Closed windows' undo history is never freed |
| MACKIT-10 | L | CONFIRMED | CONFIRMED | B-14 | Saving a blank AI key says it worked |
| MACKIT-11 | L | SUSPECTED | CONFIRMED | B-101 | Saving a new key can lose the old one if the save fails |
| MACKIT-12 | L | CONFIRMED | CONFIRMED | B-101 | The app's server password could be sent elsewhere if a link were ever malformed |
| MACKIT-13 | L | CONFIRMED | CONFIRMED | B-07 | Player Search can mix rows from two imports |
| MACKIT-14 | L | CONFIRMED | CONFIRMED | B-41 | Small memory growth, and a widget glitch on repeated lines |
