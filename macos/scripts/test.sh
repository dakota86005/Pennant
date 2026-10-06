#!/bin/bash
# The Mac app's tests (SWIFTUI_REBUILD.md section 8), run from anywhere:
#
#   macos/scripts/test.sh
#
#   1. writes the synthetic league and its CSV export into a scratch folder (npm run synthetic:league), never a real
#      save;
#   2. stages the server for the bundle (npm run mac:stage);
#   3. runs each package's Swift tests (PennantAPI, PennantKit and PennantFeatures with their real-server integration
#      tests, PennantDesign); PennantFeatures also draws the shell's snapshots into build/macos-snapshots/;
#   4. runs `xcodebuild test` on the Pennant scheme: the app with its server and the XCUITests, each test on a fresh
#      scratch data folder holding the synthetic league. The XCUITest runner is sandboxed and cannot create folders, so
#      this script prepares every test's folder (the league copied in, a pretend OOTP save, the save chosen where the
#      test wants one) and passes only the scratch root; the runner writes nothing;
#   5. extracts the XCUITest screenshots with xcresulttool.
#
# Output goes to build/macos-test/ (ignored by Git): logs/, Pennant.xcresult and screenshots/. Only summaries and
# failures are printed.
#
# Environment:
#   PENNANT_TEST_SCRATCH   the scratch folder (default: a new folder under $TMPDIR)
#   PENNANT_TEST_UNSIGNED  1 builds without signing (CODE_SIGNING_ALLOWED=NO)
#   PENNANT_TEST_NO_UI     1 skips step 4 and 5 (the package tests still run)
#   PENNANT_TEST_NO_PACKAGES  1 skips step 3 (to iterate on the UI tests)
#   PENNANT_TEST_ONLY      one UI test, as xcodebuild's -only-testing names it (PennantUITests/PennantUITests/testX)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/build/macos-test"
LOGS="$OUT/logs"
SCRATCH="${PENNANT_TEST_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/pennant-macos-test.XXXXXX")}"
mkdir -p "$LOGS" "$SCRATCH"
LEAGUE="$SCRATCH/league/league.db"
failed=0

step() { echo; echo "== $*"; }

# Runs a command with its output in a log; prints the summary lines, and the failures if it failed
run() {
  local name="$1" summary="$2"
  shift 2
  local log="$LOGS/$name.log"
  if "$@" >"$log" 2>&1; then
    grep -E "$summary" "$log" | tail -3 || true
  else
    echo "FAILED: $name (full log: $log)"
    grep -E "error:|✘|FAIL|failed|Failing tests|\*\* TEST|\*\* BUILD" "$log" | grep -v GeneratedSources | head -40 || tail -30 "$log"
    return 1
  fi
}

cd "$ROOT"
step "Synthetic league in $SCRATCH/league"
run synthetic-league "synthetic-league" npm run synthetic:league -- "$SCRATCH/league" || failed=1

step "Staging the server (npm run mac:stage)"
run stage "\[stage\] staged" npm run mac:stage || failed=1

packages=(PennantAPI PennantKit PennantDesign PennantFeatures)
if [ "${PENNANT_TEST_NO_PACKAGES:-0}" = "1" ]; then packages=(); fi
for package in ${packages[@]+"${packages[@]}"}; do
  step "swift test: $package"
  (cd "$ROOT/macos/Packages/$package" && \
    run "swift-test-$package" "Test run with|Executed" \
      env PENNANT_TEST_SCRATCH="$SCRATCH/swift" PENNANT_TEST_LEAGUE="$LEAGUE" swift test) || failed=1
done

if [ "${PENNANT_TEST_NO_UI:-0}" != "1" ]; then
  step "xcodebuild test: the Pennant scheme (app, server, XCUITests)"
  UI_SCRATCH="$SCRATCH/ui"
  rm -rf "$UI_SCRATCH" "$OUT/Pennant.xcresult" "$OUT/screenshots"
  mkdir -p "$UI_SCRATCH"
  # One folder per UI test (the method's name), each with its own data folder holding the synthetic league and a
  # pretend OOTP save that exports it; `configured` chooses the save for the server before the app starts (its config.json), `new`
  # leaves it for the Setup window to find. The runner only reads these paths.
  # A third argument writes settings.json (the appearance, the theme each club wears), and a fourth names the
  # repository's example theme packs (docs/theme-packs/<id>, space-separated) to install in the data folder.
  prepare_ui_test() {
    local test="$1" kind="$2" settings="${3:-}" packs="${4:-}"
    local root="$UI_SCRATCH/$test"
    local csv="$root/saves/Synthetic League.lg/import_export/csv"
    mkdir -p "$root/data" "$root/logs" "$csv"
    cp "$LEAGUE" "$root/data/league.db"
    # The pretend save exports the synthetic league itself: the import builds a whole new database from the export
    # (D-061), so a token file would leave a league of one table. Times kept, so the export is already settled.
    cp -p "$SCRATCH/league/export/"*.csv "$csv/"
    if [ "$kind" = "configured" ]; then
      node -e 'process.stdout.write(JSON.stringify({ csvDir: process.argv[1], saveName: "Synthetic League" }))' "$csv" \
        > "$root/data/config.json"
    fi
    if [ -n "$settings" ]; then printf '%s' "$settings" > "$root/data/settings.json"; fi
    for pack in $packs; do
      mkdir -p "$root/data/theme-packs"
      cp -R "$ROOT/docs/theme-packs/$pack" "$root/data/theme-packs/"
    done
  }
  # A pretend home for the server to find OOTP saves in (PENNANT_DEV_HOME): the synthetic league's save, last played
  # the given hours ago with its export, where OOTP 27 (direct download) keeps saves; a fourth argument makes the
  # human manage that many clubs (the export's first ones), its teams file's time kept
  prepare_home() {
    local test="$1" name="$2" hours="$3" clubs="${4:-1}"
    local lg="$UI_SCRATCH/$test/home/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/$name.lg"
    mkdir -p "$lg/import_export/csv" "$lg/settings"
    cp -p "$SCRATCH/league/export/"*.csv "$lg/import_export/csv/"
    if [ "$clubs" != "1" ]; then
      node -e '
        const fs = require("fs"); const [file, n] = [process.argv[1], Number(process.argv[2])];
        const { mtime, atime } = fs.statSync(file);
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const col = lines[0].split(",").indexOf("human_team");
        const out = lines.map((line, i) => { if (i === 0 || !line) return line; const f = line.split(","); f[col] = i <= n ? "1" : "0"; return f.join(","); });
        fs.writeFileSync(file, out.join("\n")); fs.utimesSync(file, atime, mtime);
      ' "$lg/import_export/csv/teams.csv" "$clubs"
    fi
    printf 'Show real player ratings,1\n' > "$lg/settings/db_dump_standard_csv.cfg"
    local at
    at="$(node -e 'const d = new Date(Date.now() - Number(process.argv[1]) * 3600e3); const p = (n) => String(n).padStart(2, "0"); process.stdout.write(`${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}.${p(d.getSeconds())}`)' "$hours")"
    for f in players.dat flag_save_completed.dat; do echo x > "$lg/$f"; touch -t "$at" "$lg/$f"; done
  }
  prepare_ui_test testStartsTheServerAndQuitsCleanly configured
  prepare_ui_test testSetupFlowOnAScratchFolder new
  # The zero-question first run (N6, Stage B2): one save that clearly stands out, nothing chosen yet
  prepare_ui_test testZeroQuestionFirstRun new '{"theme":"light"}'
  prepare_home testZeroQuestionFirstRun "Synthetic League" 2
  # The club owed (N6, Stage B2 review): one save that stands out, whose human manages two clubs
  prepare_ui_test testClubOwedAfterSetupCloses new '{"theme":"light"}'
  prepare_home testClubOwedAfterSetupCloses "Two Clubs" 2 2
  prepare_ui_test testDepartmentsInspectorAndSettings configured
  # The glass shell (N5): the synthetic club (team 1, the human's) in its own colours and in the example pack
  prepare_ui_test testGlassShellClubColorsLight configured '{"theme":"light"}'
  prepare_ui_test testGlassShellClubColorsDark configured '{"theme":"dark"}'
  prepare_ui_test testGlassShellExamplePackLight configured '{"theme":"light"}' sunset-series
  prepare_ui_test testGlassShellExamplePackDark configured '{"theme":"dark","themePacks":{"1":"sunset-series"}}' sunset-series
  # The design language (N5, Stage B): the palette, the basis and the inspector; the example art pack in both appearances
  prepare_ui_test testDesignPaletteBasisAndInspector configured '{"theme":"light"}'
  prepare_ui_test testDesignArtPackLight configured '{"theme":"light","themePacks":{"1":"aurora-nights"}}' aurora-nights
  prepare_ui_test testDesignArtPackDark configured '{"theme":"dark","themePacks":{"1":"aurora-nights"}}' aurora-nights
  # The Morning Report kept across launches (N6, Stage B1): two launches on one folder; the app's caches go in it too
  prepare_ui_test testLaunchWithKeptPayload configured '{"theme":"light"}'
  # Pennant remembers, and the league is alive (N7, Stage B): the desk and ⌘Z, follow by drag, search to a club window,
  # a club's window
  prepare_ui_test testDeskMarkAndUndo configured '{"theme":"light"}'
  prepare_ui_test testFollowByDrag configured '{"theme":"light"}'
  prepare_ui_test testSearchToClubWindow configured '{"theme":"light"}'
  prepare_ui_test testClubWindow configured '{"theme":"light"}'
  # Farm & Development (N10): a desk item into Decision and its cascade; every farm view in dark
  prepare_ui_test testFarmDeskToDecision configured '{"theme":"light"}'
  prepare_ui_test testFarmViewsDark configured '{"theme":"dark"}'
  prepare_ui_test testFarmNarrowWindow configured '{"theme":"light"}'
  # Major League Ops (N8): the report's companion, the tables, a row's detail and context menu, a decision
  prepare_ui_test testMajorLeagueViews configured '{"theme":"light"}'
  prepare_ui_test testMajorLeagueNarrowWindow configured '{"theme":"light"}'
  # N9: every Major League Ops view, the clubhouse tools included, at 900 × 700 with the inspector open
  prepare_ui_test testClubhouseNarrowWindow configured '{"theme":"light"}'
  prepare_ui_test testClubhouseWideWindow configured '{"theme":"light"}'
  prepare_ui_test testClubhouseWideWindowDark configured '{"theme":"dark"}'
  prepare_ui_test testPlayerWindows configured '{"theme":"light"}'
  prepare_ui_test testCompareByMenuAndDrag configured '{"theme":"light"}'
  prepare_ui_test testPlayerWindowRestored configured '{"theme":"light"}'
  prepare_ui_test testPlayerNarrowWindow configured '{"theme":"light"}'
  prepare_ui_test testPlayerNoteKeptOnLeaving configured '{"theme":"light"}'
  # N12 Track B: League Office's and Scouting's views at 900 × 700 with the inspector open
  prepare_ui_test testLeagueOfficeNarrowWindow configured '{"theme":"light"}'
  signing=()
  if [ "${PENNANT_TEST_UNSIGNED:-0}" = "1" ]; then signing=(CODE_SIGNING_ALLOWED=NO); fi
  if [ -n "${PENNANT_TEST_ONLY:-}" ]; then signing+=("-only-testing:$PENNANT_TEST_ONLY"); fi
  # TEST_RUNNER_ variables reach the test runner without the prefix: each UI test finds its prepared folder under the
  # scratch root and launches the app on it
  run xcodebuild-test "Executed|\*\* TEST" \
    env TEST_RUNNER_PENNANT_UI_SCRATCH="$UI_SCRATCH" \
    xcodebuild -project "$ROOT/macos/Pennant.xcodeproj" -scheme Pennant -destination 'platform=macOS' \
      -derivedDataPath "$OUT/DerivedData" -resultBundlePath "$OUT/Pennant.xcresult" \
      -skipPackagePluginValidation ${signing[@]+"${signing[@]}"} test || failed=1
  # The restoration test's saved windows, if a failure left them (the runner may not reach the folder itself)
  rm -rf "$HOME/Library/Saved Application State/com.dakotawise.pennant.dev.savedState"
  # What each accessibility audit set aside, and why, and any finding: printed by the tests, repeated here for the CI log
  grep -E "^\[audit\]" "$LOGS/xcodebuild-test.log" | sort -u || true
  if grep -q "Failed to activate application" "$LOGS/xcodebuild-test.log"; then
    echo "The app started (see each test's logs/server.log under $UI_SCRATCH) but XCUITest could not bring it to the"
    echo "front. That happens while the Mac's screen is locked or asleep: unlock it and run the tests again."
  fi
  if grep -q "enabling automation mode" "$LOGS/xcodebuild-test.log"; then
    echo "UI automation is not enabled on this Mac, so the XCUITests could not drive the app. Enable it once as the"
    echo "Mac's owner (it asks for your password): run the Pennant scheme's tests from Xcode, or"
    echo "  automationmodetool enable-automationmode-without-authentication"
    echo "Or skip the UI tests: PENNANT_TEST_NO_UI=1 macos/scripts/test.sh"
  fi

  if [ -d "$OUT/Pennant.xcresult" ]; then
    step "Screenshots"
    mkdir -p "$OUT/screenshots"
    if xcrun xcresulttool export attachments --path "$OUT/Pennant.xcresult" --output-path "$OUT/screenshots" \
      >"$LOGS/attachments.log" 2>&1; then
      # Keep only the tests' own named window screenshots (and the audit's findings), under their names; anything the
      # system attached (a screen recording, a full-screen capture, an event log) is removed, since it can show more
      # than the app
      node -e '
        const fs = require("fs"), path = require("path");
        const dir = process.argv[1];
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
        const keep = /^(main-window|setup-|department-|inspector-open|settings-|morning-report|major-league-report|accessibility-audit|glass-|design-|launch-|n7-|n8-|n9-|n10-|n11-|n12b-)/;
        const kept = new Set();
        for (const test of manifest) for (const a of test.attachments ?? []) {
          const name = a.suggestedHumanReadableName ?? "";
          const from = path.join(dir, a.exportedFileName);
          if (!keep.test(name) || !fs.existsSync(from)) continue;
          const to = path.join(dir, name.replace(/_\d+_[0-9A-F-]+(\.\w+)$/i, "$1"));
          fs.renameSync(from, to);
          kept.add(path.basename(to));
        }
        for (const f of fs.readdirSync(dir)) if (!kept.has(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      ' "$OUT/screenshots"
      count="$(find "$OUT/screenshots" -type f -name '*.png' | wc -l | tr -d ' ')"
      echo "$count window screenshot(s) in build/macos-test/screenshots/"
      if [ -f "$OUT/screenshots/accessibility-audit.txt" ]; then echo "Accessibility audit findings: build/macos-test/screenshots/accessibility-audit.txt"; fi
    else
      echo "Could not extract the attachments (see $LOGS/attachments.log)"
    fi
  fi
fi

if [ -d "$ROOT/build/macos-snapshots" ]; then
  echo
  echo "$(find "$ROOT/build/macos-snapshots" -name '*.png' | wc -l | tr -d ' ') snapshot(s) in build/macos-snapshots/"
fi

echo
if [ "$failed" = "0" ]; then echo "All Mac tests passed."; else echo "Some Mac tests FAILED (logs in build/macos-test/logs/)."; fi
exit "$failed"
