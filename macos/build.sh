#!/bin/sh
# Сборка ccost.app: swiftc + иконка + движок внутрь Resources.
# Движок — полноценный бинарь: CCOST_ENGINE=/путь/к/бинарю sh build.sh
# (иначе соберётся pyinstaller'ом из PATH; последний фолбэк — скрипт,
# такой сборке нужен системный python3 — только для разработки).
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
    echo "внимание: pyinstaller не найден — кладу скрипт (нужен python3)" >&2
    cp ../ccost "$APP/Contents/Resources/ccost"
fi
chmod +x "$APP/Contents/Resources/ccost"
cp Info.plist "$APP/Contents/Info.plist"
swift gen-icon.swift dist/ccost.iconset
iconutil -c icns dist/ccost.iconset -o "$APP/Contents/Resources/ccost.icns"
rm -rf dist/ccost.iconset
echo "готово: macos/dist/ccost.app"
