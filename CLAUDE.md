@AGENTS.md

## Claude Code working habits

- The repository's source, tests and docs are authoritative. Claude memory is a
  convenience that goes stale; verify anything it says before relying on it.
- Read the relevant section of a large doc, not the whole file. When a D-number
  or heading is known, search for it and read from there.
- Use Explore or other subagents only for broad, noisy investigation across
  many files. Do simple, sequential work directly.
- While iterating, run the targeted test file (`npx vitest run tests/<file>`);
  run the full validation baseline once, at the completion boundary.
- When only the result or the failures matter, keep verbose build and test
  output out of the conversation (summary lines and failures only).
- Start a fresh session for unrelated work instead of carrying an old task.
