#!/bin/sh

echo "Stopping Lightpanda..."

docker rm -f lightpanda 2>/dev/null || true

echo "Lightpanda container removed."