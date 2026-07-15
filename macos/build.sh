#!/bin/sh
# Сборка ccost.app: swiftc + иконка + скрипт ccost внутрь Resources.
set -e
cd "$(dirname "$0")"
APP="dist/ccost.app"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/ccost-app" ccost-app.swift
cp ../ccost "$APP/Contents/Resources/ccost"
cp Info.plist "$APP/Contents/Info.plist"
swift gen-icon.swift dist/ccost.iconset
iconutil -c icns dist/ccost.iconset -o "$APP/Contents/Resources/ccost.icns"
rm -rf dist/ccost.iconset
echo "готово: macos/dist/ccost.app"
