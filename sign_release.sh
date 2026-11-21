#!/usr/bin/env bash
set -e
if [ -z "$KEYSTORE_B64" ]; then
  ./gradlew assembleDebug
  cp app/build/outputs/apk/debug/app-debug.apk ../IDEan.apk
  exit 0
fi
./gradlew assembleRelease
echo "$KEYSTORE_B64" | base64 -d > release.jks
BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
"$BT/zipalign" -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
"$BT/apksigner" sign --ks release.jks --ks-pass env:KS_PASS --ks-key-alias "$KEY_ALIAS" --key-pass env:KEY_PASS --out ../IDEan.apk aligned.apk
rm -f release.jks aligned.apk
