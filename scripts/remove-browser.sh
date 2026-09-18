#!/bin/sh

echo "Stopping Chromium CDP..."

docker rm -f chromium-cdp 2>/dev/null || true

echo "Stopping Chromium-noip..."

docker rm -f chromium-noip 2>/dev/null || true

echo "Chromium containers removed."