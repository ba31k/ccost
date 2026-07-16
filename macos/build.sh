#!/bin/sh
# Build ccost.app: swiftc + icon + engine into Resources.
# The engine is a standalone binary: CCOST_ENGINE=/path/to/binary sh build.sh
# (otherwise pyinstaller from PATH builds it; last fallback is the script,
# which needs system python3 — dev only).
set -e
cd "$(dirname "$0")"
APP="dist/ccost.app"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/ccost-app" ccost-app.swift
if [ -n "$CCOST_ENGINE" ] && [ -f "$CCOST_ENGINE" ]; then
    cp "$CCOST_ENGINE" "$APP/Contents/Resources/ccost"
elif command -v pyinstaller >/dev/null 2>&1; then
    cp ../ccost dist/ccost.py
    pyinstaller --onefile --name ccost-engine --distpath dist/engine \
        --workpath dist/build --specpath dist dist/ccost.py
    cp dist/engine/ccost-engine "$APP/Contents/Resources/ccost"
else
    echo "warning: pyinstaller not found — bundling the script (needs python3)" >&2
    cp ../ccost "$APP/Contents/Resources/ccost"
fi
chmod +x "$APP/Contents/Resources/ccost"
cp Info.plist "$APP/Contents/Info.plist"
swift gen-icon.swift dist/ccost.iconset
iconutil -c icns dist/ccost.iconset -o "$APP/Contents/Resources/ccost.icns"
rm -rf dist/ccost.iconset
echo "done: macos/dist/ccost.app"
