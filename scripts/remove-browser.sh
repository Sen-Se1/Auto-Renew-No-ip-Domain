#!/bin/sh

echo "Stopping Chromium CDP..."

docker rm -f chromium-cdp 2>/dev/null || true

echo "Stopping Chromium..."

docker rm -f chromium 2>/dev/null || true

echo "Chromium containers removed."