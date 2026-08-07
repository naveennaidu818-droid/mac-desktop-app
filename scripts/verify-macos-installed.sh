#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-/Applications/VitelGlobal Desktop.app}"
expected_version="${2:-1.0.10}"
bundle_id="com.vitelglobal.desktop"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

test -d "$app_path" || fail "App is not installed at $app_path"

plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/VitelGlobal Desktop"
test -f "$plist" || fail "Info.plist is missing"
test -x "$executable" || fail "Main executable is missing"

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
alert_style="$(/usr/libexec/PlistBuddy -c 'Print :NSUserNotificationAlertStyle' "$plist")"
architectures="$(lipo -archs "$executable")"

test "$version" = "$expected_version" || fail "Installed version is $version, expected $expected_version"
test "$identifier" = "$bundle_id" || fail "Bundle identifier is $identifier, expected $bundle_id"
test "$alert_style" = "alert" || fail "NSUserNotificationAlertStyle is not alert"
grep -qw arm64 <<<"$architectures" || fail "Apple Silicon architecture is missing"
grep -qw x86_64 <<<"$architectures" || fail "Intel architecture is missing"

codesign --verify --deep --strict --verbose=2 "$app_path"
codesign --display --verbose=4 "$app_path" 2>&1 | grep -q 'Developer ID Application:' \
  || fail "Developer ID Application signature is missing"
spctl --assess --type execute --verbose=4 "$app_path"
xcrun stapler validate "$app_path"

printf 'PASS: Installed app identity, version, universal architectures, signature, Gatekeeper, and stapling are valid.\n'
printf 'NEXT: System Settings > Notifications > VitelGlobal Desktop > Allow Notifications = On.\n'
printf 'NEXT: In VitelGlobal Desktop choose VitelGlobal > Test macOS Notification and confirm both the banner and Notification Center entry.\n'
printf 'NEXT: With the app visible, hidden, minimized, and reopened after an offline interval, place an incoming call and verify banner, ringtone, Accept/Reject, routing, and cleanup.\n'
