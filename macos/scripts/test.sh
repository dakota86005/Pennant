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
#   PENNANT_TEST_ONLY      UI tests to run, as xcodebuild's -only-testing names them (PennantUITests/PennantUITests/testX),
#                          separated by spaces: run in the suite's order, to reproduce one test's effect on the next
#   PENNANT_TEST_SHARD     run one CI shard's UI tests (macos/scripts/ui-test-shards.json; the catch-all shard also runs
#                          every test no shard lists); PENNANT_TEST_ONLY wins over it
#   PENNANT_TEST_BUILD_ONLY  1 builds the app and its UI tests (xcodebuild build-for-testing) after steps 1 and 2 and runs
#                          none: CI's build job, whose products (build/macos-test/DerivedData/Build/Products/) and
#                          synthetic league (the scratch folder's league/) its shard jobs download
#   PENNANT_TEST_PREBUILT  1 runs the UI tests on what a PENNANT_TEST_BUILD_ONLY run left, with test-without-building: the
#                          products in build/macos-test/DerivedData/Build/Products/ and the league in the scratch folder;
#                          nothing is generated, staged or built (CI's shard jobs)
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
if [ "${PENNANT_TEST_PREBUILT:-0}" = "1" ]; then
  # The build job's league and products: nothing to generate or stage (the server is inside the built app)
  if [ ! -f "$LEAGUE" ] || [ -z "$(ls "$OUT/DerivedData/Build/Products/"*.xctestrun 2>/dev/null)" ]; then
    echo "FAILED: PENNANT_TEST_PREBUILT=1 needs the synthetic league in $SCRATCH/league and the built products in"
    echo "$OUT/DerivedData/Build/Products/ (an .xctestrun file): run with PENNANT_TEST_BUILD_ONLY=1 first."
    exit 1
  fi
else
  step "Synthetic league in $SCRATCH/league"
  run synthetic-league "synthetic-league" npm run synthetic:league -- "$SCRATCH/league" || failed=1

  step "Staging the server (npm run mac:stage)"
  run stage "\[stage\] staged" npm run mac:stage || failed=1
fi

packages=(PennantAPI PennantKit PennantDesign PennantFeatures)
if [ "${PENNANT_TEST_NO_PACKAGES:-0}" = "1" ]; then packages=(); fi
for package in ${packages[@]+"${packages[@]}"}; do
  step "swift test: $package"
  (cd "$ROOT/macos/Packages/$package" && \
    run "swift-test-$package" "Test run with|Executed" \
      env PENNANT_TEST_SCRATCH="$SCRATCH/swift" PENNANT_TEST_LEAGUE="$LEAGUE" swift test) || failed=1
done

signing=()
if [ "${PENNANT_TEST_UNSIGNED:-0}" = "1" ]; then signing=(CODE_SIGNING_ALLOWED=NO); fi
if [ "${PENNANT_TEST_BUILD_ONLY:-0}" = "1" ]; then
  step "xcodebuild build-for-testing: the Pennant scheme (app, server, XCUITests), for the shard jobs"
  run xcodebuild-build "\*\* TEST BUILD" \
    xcodebuild -project "$ROOT/macos/Pennant.xcodeproj" -scheme Pennant -destination 'platform=macOS' \
      -derivedDataPath "$OUT/DerivedData" -skipPackagePluginValidation ${signing[@]+"${signing[@]}"} \
      build-for-testing || failed=1
elif [ "${PENNANT_TEST_NO_UI:-0}" != "1" ]; then
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
  # N12, Track A: every Finance and Medical view at 900 × 700 with the inspector open
  prepare_ui_test testFinanceNarrowWindow configured '{"theme":"light"}'
  # N12 Track B: League Office's and Scouting's views at 900 × 700 with the inspector open
  prepare_ui_test testLeagueOfficeNarrowWindow configured '{"theme":"light"}'
  prepare_ui_test testPlayerSearchFullPageAudit configured '{"theme":"light"}'
  # N12 Track C: Trades and Philosophy & Staff at 900 × 700 with the inspector open
  prepare_ui_test testTradesNarrowWindow configured '{"theme":"light"}'
  # N13: the AI surfaces with AI off (no key: the app's keys in memory), and the Staff room answering through the
  # stand-in provider on this Mac (the chat set to the local provider, pointed at macos/scripts/fake-ai-provider.mjs)
  prepare_ui_test testStaffRoomAiOff configured '{"theme":"light"}'
  prepare_ui_test testStorylinesAndBriefingAiOff configured '{"theme":"dark"}'
  prepare_ui_test testStaffRoomAnswer configured '{"theme":"light","aiFeatures":{"chat":{"provider":"ollama","model":"stub"}}}'
  # Which tests: PENNANT_TEST_ONLY's, else one CI shard's (its own, or for the catch-all every test the other shards
  # do not run), else all of them
  selection=()
  if [ -n "${PENNANT_TEST_ONLY:-}" ]; then
    for only in $PENNANT_TEST_ONLY; do selection+=("-only-testing:$only"); done
  elif [ -n "${PENNANT_TEST_SHARD:-}" ]; then
    shard_args="$(node "$ROOT/macos/scripts/ui-test-shards.mjs" args "$PENNANT_TEST_SHARD")" || exit 1
    while IFS= read -r arg; do if [ -n "$arg" ]; then selection+=("$arg"); fi; done <<< "$shard_args"
    echo "Shard $PENNANT_TEST_SHARD: ${#selection[@]} xcodebuild selection argument(s) (macos/scripts/ui-test-shards.json)"
  fi
  if [ "${PENNANT_TEST_PREBUILT:-0}" = "1" ]; then
    xctestrun="$(ls "$OUT/DerivedData/Build/Products/"*.xctestrun | head -1)"
    xcode=(xcodebuild -xctestrun "$xctestrun" -destination 'platform=macOS' -resultBundlePath "$OUT/Pennant.xcresult"
      ${selection[@]+"${selection[@]}"} test-without-building)
  else
    xcode=(xcodebuild -project "$ROOT/macos/Pennant.xcodeproj" -scheme Pennant -destination 'platform=macOS'
      -derivedDataPath "$OUT/DerivedData" -resultBundlePath "$OUT/Pennant.xcresult" -skipPackagePluginValidation
      ${signing[@]+"${signing[@]}"} ${selection[@]+"${selection[@]}"} test)
  fi
  # The stand-in AI provider (N13), on a free port of 127.0.0.1, for the Staff room's answering test; stopped below
  fake_ai=()
  fake_port="$SCRATCH/fake-ai.port"
  rm -f "$fake_port"
  node "$ROOT/macos/scripts/fake-ai-provider.mjs" "$fake_port" >"$LOGS/fake-ai-provider.log" 2>&1 &
  fake_pid=$!
  for _ in $(seq 1 150); do [ -s "$fake_port" ] && break; sleep 0.1; done
  if [ -s "$fake_port" ]; then
    fake_ai=(TEST_RUNNER_PENNANT_UI_LOCAL_AI="http://127.0.0.1:$(cat "$fake_port")")
  else
    echo "The stand-in AI provider did not start (see $LOGS/fake-ai-provider.log): the Staff room's answering test skips"
  fi
  # TEST_RUNNER_ variables reach the test runner without the prefix: each UI test finds its prepared folder under the
  # scratch root and launches the app on it
  run xcodebuild-test "Executed|\*\* TEST" env TEST_RUNNER_PENNANT_UI_SCRATCH="$UI_SCRATCH" ${fake_ai[@]+"${fake_ai[@]}"} "${xcode[@]}" || failed=1
  kill "$fake_pid" 2>/dev/null || true
  # The restoration test's saved windows, if a failure left them (the runner may not reach the folder itself)
  rm -rf "$HOME/Library/Saved Application State/com.dakotawise.pennant.dev.savedState"
  # What each accessibility audit set aside, and why, and any finding, and a quit that needed help or did not finish:
  # printed by the tests, repeated here for the CI log
  grep -E "^\[(audit|quit|palette|focus)\]" "$LOGS/xcodebuild-test.log" | sort -u || true
  # Each test's app log (the server's lines and the app's own: the launch, the quit's steps), kept with the run's logs
  # (the CI artifact): the synthetic league's only. With them, a hung main thread's stack (`hang-*.log`, PR #60)
  for log in "$UI_SCRATCH"/*/logs/server*.log "$UI_SCRATCH"/*/logs/hang-*.log; do
    [ -f "$log" ] || continue
    test_name="$(basename "$(dirname "$(dirname "$log")")")"
    mkdir -p "$LOGS/ui-tests/$test_name"
    cp "$log" "$LOGS/ui-tests/$test_name/"
  done
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
        const keep = /^(main-window|setup-|department-|inspector-open|settings-|morning-report|major-league-report|accessibility-audit|glass-|design-|launch-|n7-|n8-|n9-|n10-|n11-|n12-|n12a-|n12b-|n12c-|n13-)/;
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
