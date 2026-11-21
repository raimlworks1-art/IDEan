#!/usr/bin/env bash
set -e
[ -d node_modules/@capacitor/android ] || { npm i @capacitor/core @capacitor/android; npm i -D @capacitor/cli; }
npm run build
[ -d android ] || npx cap add android
npx cap sync android
bash apply_icon.sh
echo "sdk.dir=${ANDROID_HOME:?set ANDROID_HOME}" > android/local.properties
AAPT2="$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 | tail -1)"
cd android
./gradlew assembleDebug -Pandroid.aapt2FromMavenOverride="$AAPT2"
cp app/build/outputs/apk/debug/app-debug.apk ../IDEan.apk
