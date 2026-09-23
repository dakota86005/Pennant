import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { matchesGlob } from 'node:path';

/**
 * The agent-instruction routing stays wired to the repository.
 *
 * `.claude/rules/*.md` are Claude Code reminders that load when a file matching their
 * `paths:` is read, and AGENTS.md's routing table names each one. A rename or deletion
 * would otherwise leave a rule silently never loading, or the table pointing at nothing.
 * Two rules may claim the same file on purpose, so overlap is not checked.
 */
const RULES_DIR = '.claude/rules';
const read = (path: string): string => readFileSync(path, 'utf8');

// Tracked files, so a local build output or import can never keep a dead path alive.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

const ruleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).sort();

/** The `paths:` list of a rule's frontmatter: only the narrow shape these files use. */
function rulePaths(file: string): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read(`${RULES_DIR}/${file}`));
  if (!frontmatter) throw new Error(`${file}: no frontmatter block`);
  const lines = frontmatter[1].split('\n');
  if (lines[0] !== 'paths:') throw new Error(`${file}: frontmatter does not start with "paths:"`);
  return lines.slice(1).map((line) => {
    const entry = /^ {2}- "([^"]+)"$/.exec(line);
    if (!entry) throw new Error(`${file}: unrecognised paths entry ${JSON.stringify(line)}`);
    return entry[1];
  });
}

/** Rule files named in the Claude-rule column of AGENTS.md's routing table. */
function routedRules(): string[] {
  const rows = read('AGENTS.md').split('\n').filter((line) => line.startsWith('|'));
  const header = rows.findIndex((row) => /\|\s*Subsystem\s*\|.*\|\s*Claude rule\s*\|/.test(row));
  if (header < 0) throw new Error('AGENTS.md: routing table header not found');
  return rows.slice(header + 2).flatMap((row) => {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    const rule = cells[cells.length - 1];
    if (rule === '—') return [];
    const ref = /^`\.claude\/rules\/([^`]+)`$/.exec(rule);
    if (!ref) throw new Error(`AGENTS.md: unrecognised Claude rule cell ${JSON.stringify(rule)}`);
    return [ref[1]];
  });
}

describe('agent instruction routing', () => {
  it('finds the rules', () => {
    expect(ruleFiles.length).toBeGreaterThan(0);
  });

  it.each(ruleFiles)('%s: every path matches a tracked file', (file) => {
    const paths = rulePaths(file);
    expect(paths.length).toBeGreaterThan(0);
    const dead = paths.filter((pattern) => !tracked.some((f) => matchesGlob(f, pattern)));
    expect(dead, `${file} has paths matching no tracked file`).toEqual([]);
  });

  it('routes every rule from AGENTS.md, and every routed rule exists', () => {
    const routed = routedRules();
    expect(ruleFiles.filter((f) => !routed.includes(f)), 'rules missing from the AGENTS.md routing table').toEqual([]);
    expect(routed.filter((f) => !ruleFiles.includes(f)), 'AGENTS.md routes to rules that do not exist').toEqual([]);
  });
});
