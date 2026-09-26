#!/bin/bash
# The Mac app's tests (SWIFTUI_REBUILD.md section 8), run from anywhere:
#
#   macos/scripts/test.sh
#
#   1. writes the synthetic league into a scratch folder (npm run synthetic:league), never a real save;
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
  # pretend OOTP save; `configured` chooses the save for the server before the app starts (its config.json), `new`
  # leaves it for the Setup window to find. The runner only reads these paths.
  prepare_ui_test() {
    local test="$1" kind="$2"
    local root="$UI_SCRATCH/$test"
    local csv="$root/saves/Synthetic League.lg/import_export/csv"
    mkdir -p "$root/data" "$root/logs" "$csv"
    cp "$LEAGUE" "$root/data/league.db"
    printf 'id,note\n1,one\n2,two\n' > "$csv/zz_ui_check.csv"
    if [ "$kind" = "configured" ]; then
      node -e 'process.stdout.write(JSON.stringify({ csvDir: process.argv[1], saveName: "Synthetic League" }))' "$csv" \
        > "$root/data/config.json"
    fi
  }
  prepare_ui_test testStartsTheServerAndQuitsCleanly configured
  prepare_ui_test testSetupFlowOnAScratchFolder new
  prepare_ui_test testDepartmentsInspectorAndSettings configured
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
        const keep = /^(main-window|setup-|department-|inspector-open|settings-|accessibility-audit)/;
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
