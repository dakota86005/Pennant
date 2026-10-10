#!/bin/bash
# Proves on GitHub's macOS runner that the app's Keychain code (KeychainItems.swift) never shows a dialog (N13, D-074):
# an item made by one copy of the code, read and replaced by a copy signed differently (as a rebuilt development app
# is), with the person at the Mac never asked. A control step lets the system ask, to show the check would see a dialog.
#
# CI only. It makes a throwaway keychain, makes it the default for the run and puts the old one back after; it never
# reads or writes any other keychain's items. On a Mac someone is using the control step would put a dialog on their
# screen, so it refuses to run unless CI=true.
set -uo pipefail

if [ "${CI:-}" != "true" ]; then
  echo "keychain-no-prompt.sh runs on CI only (it may show a Keychain dialog on purpose)" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${KEYCHAIN_PROBE_OUT:-$root/build/keychain-probe}"
mkdir -p "$out"
work="$(mktemp -d)"
log="$out/keychain-probe.log"
: > "$log"
say() { echo "$*" | tee -a "$log"; }
failures=0
expect() { # expect <what> <pattern> <output>
  if printf '%s' "$3" | grep -qE "$2"; then say "PASS: $1"; else say "FAIL: $1 (wanted /$2/)"; failures=$((failures + 1)); fi
}
# Runs a command for at most $1 seconds (macOS has no timeout(1)): an alarm ends it with status 142
within() { local seconds="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"; }

say "== building the probe"
swiftc -O -swift-version 6 "$root/macos/Packages/PennantKit/Sources/PennantKit/KeychainItems.swift" \
  "$root/macos/scripts/keychain-probe/main.swift" -o "$work/probe" || exit 1
cp "$work/probe" "$work/probe-a"
cp "$work/probe" "$work/probe-b"
# Two signatures, two designated requirements: the second copy is a stranger to the first one's items
codesign -f -s - -i com.dakotawise.pennant.probe.first "$work/probe-a"
codesign -f -s - -i com.dakotawise.pennant.probe.second "$work/probe-b"
codesign -dr - "$work/probe-a" 2>&1 | tee -a "$log"
codesign -dr - "$work/probe-b" 2>&1 | tee -a "$log"

say "== a throwaway keychain as the default"
keychain="$work/probe.keychain-db"
old_default="$(security default-keychain -d user | sed 's/^ *"//; s/"$//')"
old_list=()
while IFS= read -r line; do old_list+=("$(echo "$line" | sed 's/^ *"//; s/"$//')"); done < <(security list-keychains -d user)
restore() {
  security default-keychain -d user -s "$old_default" 2>/dev/null
  security list-keychains -d user -s "${old_list[@]}" 2>/dev/null
  security delete-keychain "$keychain" 2>/dev/null
  rm -rf "$work"
}
trap restore EXIT
security create-keychain -p probe "$keychain"
security set-keychain-settings "$keychain"
security unlock-keychain -p probe "$keychain"
security list-keychains -d user -s "$keychain" "${old_list[@]}"
security default-keychain -d user -s "$keychain"
service="com.dakotawise.pennant.probe.$RANDOM"
say "service: $service"

step() { # step <label> <seconds> <command...>
  local label="$1" seconds="$2"; shift 2
  local started=$SECONDS output status
  output="$(within "$seconds" "$@" 2>&1)"; status=$?
  say "-- $label: exit $status after $((SECONDS - started)) s"
  printf '%s\n' "$output" | sed 's/^/   /' | tee -a "$log" >/dev/null
  LAST="$output"
  LAST_STATUS=$status
}

step "the first copy saves a key" 30 "$work/probe-a" save "$service" anthropic sk-probe-first
expect "the first copy saved its key" '^saved$' "$LAST"
expect "the switch that forbids dialogs is there" 'was found' "$LAST"
step "the first copy reads it" 30 "$work/probe-a" read "$service"
expect "the first copy reads its own key without a dialog" 'readable: anthropic' "$LAST"

step "the second copy reads it (no dialog allowed)" 30 "$work/probe-b" read "$service"
[ "$LAST_STATUS" = 142 ] && say "FAIL: the second copy's read hung (a dialog)" && failures=$((failures + 1))
expect "the second copy finds the key unreadable, at once, instead of asking" 'unreadable: anthropic' "$LAST"

say "== the control: the same read with the system free to ask"
( sleep 6; screencapture -x "$out/control-dialog.png" ) &
step "the second copy reads it, dialogs allowed" 15 "$work/probe-b" read-allowing-dialog "$service" anthropic
if [ "$LAST_STATUS" = 142 ]; then
  say "CONTROL: the read waited on a dialog until stopped (see control-dialog.png): the check above would have seen one"
else
  say "CONTROL: the read ended by itself ($LAST): no dialog was shown on this runner, so the check above proves less"
fi
wait

step "the second copy saves the key again" 30 "$work/probe-b" save "$service" anthropic sk-probe-second
[ "$LAST_STATUS" = 142 ] && say "FAIL: saving again hung (a dialog)" && failures=$((failures + 1))
expect "the second copy keeps the key again beside the first copy's item, which it may not delete" '^saved$' "$LAST"
step "the second copy reads it now" 30 "$work/probe-b" read "$service"
expect "the second copy reads its own key" 'readable: anthropic' "$LAST"
step "the first copy reads (no dialog allowed)" 30 "$work/probe-a" read "$service"
[ "$LAST_STATUS" = 142 ] && say "FAIL: the first copy's read hung (a dialog)" && failures=$((failures + 1))
expect "the first copy still reads its own item, never asking about the second's" 'readable: anthropic' "$LAST"
step "the second copy removes its key" 30 "$work/probe-b" remove "$service" anthropic
[ "$LAST_STATUS" = 142 ] && say "FAIL: removing hung (a dialog)" && failures=$((failures + 1))
expect "the second copy removes what it may, leaving the first copy's item alone" '^removed$' "$LAST"
step "the second copy reads after removing" 30 "$work/probe-b" read "$service"
expect "only the first copy's item is left, unreadable to the second" 'unreadable: anthropic' "$LAST"
step "the first copy removes its own" 30 "$work/probe-a" remove "$service" anthropic
expect "the first copy removes its own item" '^removed$' "$LAST"
step "nothing is left" 30 "$work/probe-a" read "$service"
expect "nothing is left" 'unreadable: $' "$LAST"

say "== $failures failure(s)"
[ "$failures" = 0 ]
