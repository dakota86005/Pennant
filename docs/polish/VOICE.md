# How Pennant talks

*Draft for the owner\'s approval (N15 polish push, 2026-10-14). Nothing in the app follows it until the owner approves.*

*Draft voice guide, N15. For anyone writing a word the GM will read: the phrasebook, a hover, a widget line, the AI staff.*

## The anchor

The owner read this and called it perfect. Everything below is an attempt to explain why, so the rest of the app can sound like it.

> Tim Tawa isn't hitting enough to hold left field.
> Over 293 plate appearances his bat ranks near the bottom of the league's regular left fielders, though his glove is among the best there. It's still a small sample, so the staff would keep watching for now.
> *If you want to make a change:* Alek Thomas is the only bench option who'd be a step up, and a small one. Optioning Tawa to Reno opens the spot; he has 2 option years left.

Here's what it does. The first line is the answer. The next two say why and how sure we are. The last two tell you what you could do about it and what that costs. Nine sentences on today's page became five, and nothing true was lost: the 0–100 numbers, the blend and the lines are all still one click away.

## Who's talking

It's your own front office: a sharp assistant GM who has read every report and is handing you the short version across the desk. They talk about players the way baseball people do. They don't read you a stats paper, and they don't chat. They'll tell you what they see and what they'd do, and they never forget it's your call.

They say "the staff" or "we" for the organization and "you" for the GM. They don't say "Pennant thinks". The app doesn't have opinions; the staff do, and the app shows you their work.

## The rules

**1. Lead with the answer.** The first line says what's going on in baseball terms. Context comes after it.

- Today: "Tim Tawa (left fielder): well below the line for regular left fielders; tools and results both point to a weak spot"
- Better: "Tim Tawa isn't hitting enough to hold left field."

**2. Each number once, with its meaning.** If a number is worth showing, say what it means the first time and don't repeat it. Today's Tawa page says "29 on the 0–100 scale" five times.

- Today: "Tools 29 on the 0–100 scale, results 8 on the 0–100 scale (293 PA, trusted 37%)", then the same again in four more places.
- Better: "Over 293 plate appearances his bat ranks near the bottom of the league's regular left fielders." The 29, the 8 and the 37% live behind *Why?*, once each.

**3. Baseball words over scales.** A place on the 0–100 scale becomes the words a scout would use: "near the bottom of the league's regular left fielders", "among the best gloves in left", "about average". Use a percentage only when it's a real share of real players ("better than 29% of big-league hitters"). The raw number goes in *Why?* or a hover. It's still there, just not in the sentence.

- Today: "His glove (94 on the 0–100 scale at left field) is well ahead of his bat (21 on the 0–100 scale)"
- Better: "...though his glove is among the best there."

**4. Say uncertainty like a person.** People say "it's early" and "small sample". They don't say "trusted 37% as his level".

- Today: "His results are only trusted 37% as his level so far."
- Better: "It's still a small sample, so the staff would keep watching for now."

**5. Options, never orders.** The staff can say what they'd do and what's available. They never tell the GM what to do. Offer a move as "If you want to make a change: …", never "You should…", "Move him" or "Option Tawa." A sentence about a baseball move never starts with a command. (A chore inside the app is different. "Open the save in OOTP" is fine, because it's help, not a baseball decision.)

- Today: "A flag for your attention, not a move: whether to move him is your call. It says where the evidence points and how sure it is."
- Better: *If you want to make a change:* "Optioning Tawa to Reno opens the spot." The shape says it's an option, so the disclaimer isn't needed.

**6. Say unknowns honestly and briefly.** If we don't know, say so in one short sentence, and say what would tell us. Never guess, never fill the gap with an average, and never let "we can't tell" read as "he's bad" or "he's fine". The full reasons go behind *Why?*.

- Today: "Player Development can't say yet" (this one's already good).
- Today: "How long he would be needed is not known, so it is not assumed. Player Development judged both temporary depth and a durable assignment; where the answer differs, the duration decides, and it says so. A temporary assignment can be…" (and three more sentences)
- Better: "How long would you need him? We don't assume. Player Development checked both a short stay and a lasting job."

**7. No method words on the page.** "Working estimate", "lens", "0–100 scale", "read firm", "the man under review", "weighted sample", "wOBA" and "trusted 37%" all belong in *Why?*, where someone who wants the method can find it. The banned-words test already keeps out "percentile", "holders" and the doc numbers. The phrasebook adds these.

- Today: "Against the man under review +5 over him · read firm"
- Better: "A small step up on Tawa, and we've seen enough of him to say so."

**8. Vary the sentence shape. Contractions are fine.** Nine lines that all start "His …" read like a printout. Mix short and long sentences, and use "isn't", "he'd" and "it's" the way people talk. The phrasebook can carry two or three wordings of the same line, so a page with five flagged players doesn't say the same sentence five times.

**9. Let the phrasebook handle plurals and grammar.** "Started 1 games", "3 other player(s)", "what regular left fielders takes" and "at left fielder" are all on screen today. Nobody writes plurals or articles by hand any more: each message says `{count, plural, one {# game} other {# games}}` once, and a test runs every message with 0, 1 and 2.

## The shape of a page

**Headline.** One sentence, about 12 words or fewer, that a GM could say out loud.

**Body.** One or two sentences: why, and how sure we are.

**Options or key figures.** What you could do, with what it costs. Or, on a report, the two or three numbers that matter, each with a word saying what it means.

**Why?** Everything else goes behind a *Why?* disclosure or a hover: the scale numbers, the blend, the lines, the sample, where each fact came from, what isn't known and what would change the read. It's written in the same voice, in full sentences or short labelled lines, never a pasted debug dump.

**Budgets** (a test holds them):
- a headline of about 12 words or fewer;
- a body of about 2 sentences;
- a card of 3 visible lines;
- a hover of 75 characters or fewer (already the rule).

## What "show the basis" means now

It means the same thing it always did: every conclusion carries its evidence, says what's missing and what would change it, and nothing is ranked by a number you can't see. What changes is *where* it lives. The basis comes out of the body and goes one click away, behind *Why?* or the ⓘ, and it's written so a person can read it. If a GM asks "says who?", the answer is always one click away and always readable. It's never crammed into the sentence.

## Lines we don't cross

These come from the doctrine and the voice doesn't change them.

- **The app decides, the staff explain, you choose** (D-001, D-004). Words never turn a flag into an order or a ranking into a verdict.
- **Unknown stays unknown** (D-018). The words for "we can't tell" never lean good or bad.
- **No odds or buy/sell talk outside Standings** (D-060). The Morning Report, the desk and the cards talk about facts: record, place, runs, the next game.
- **Words never change a judgement.** A wording band like "near the bottom" describes the number the code already judged. It never decides whether something is flagged, how strongly, or in what order.
