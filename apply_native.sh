#!/usr/bin/env bash
set -e
JAVA_DIR=android/app/src/main/java/com/xyr/idean
mkdir -p "$JAVA_DIR"
cp native/DiskAccessPlugin.java native/MainActivity.java "$JAVA_DIR"/
node native/patch_manifest.mjs
