#!/bin/bash

LIGHTPANDA_NAME="lightpanda"
LIGHTPANDA_IMAGE="lightpanda/browser:nightly"

SERVER_IP="192.168.1.100"

echo "======================================"
echo "Starting Lightpanda"
echo "======================================"

# Remove old container
docker rm -f "$LIGHTPANDA_NAME" 2>/dev/null

# --------------------------------------------------
# Start Lightpanda (CDP server binds directly, no
# separate socat bridge needed like with Chromium)
# --------------------------------------------------

docker run -d \
    --name "$LIGHTPANDA_NAME" \
    --hostname "$LIGHTPANDA_NAME" \
    --restart unless-stopped \
    --privileged \
    -p 9222:9222 \
    "$LIGHTPANDA_IMAGE"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to start Lightpanda."
    exit 1
fi

echo
echo "Lightpanda container started."
echo

# --------------------------------------------------
# Wait for container
# --------------------------------------------------

echo "Waiting for Lightpanda container..."

while true; do

    STATUS=$(docker inspect \
        -f '{{.State.Status}}' \
        "$LIGHTPANDA_NAME" 2>/dev/null)

    if [ "$STATUS" = "running" ]; then
        echo "Lightpanda container is running."
        break
    fi

    sleep 1
done


# --------------------------------------------------
# Show Lightpanda logs
# --------------------------------------------------

echo
echo "======================================"
echo "Lightpanda logs"
echo "======================================"

sleep 3

docker logs "$LIGHTPANDA_NAME"


# --------------------------------------------------
# CDP test
# --------------------------------------------------

echo
echo "======================================"
echo "Testing CDP"
echo "======================================"

echo
echo "curl http://$SERVER_IP:9222/json/version"
echo

curl "http://$SERVER_IP:9222/json/version"

if [ $? -eq 0 ]; then
    echo
    echo
    echo "======================================"
    echo "CDP TEST SUCCESS"
    echo "======================================"
else
    echo
    echo
    echo "======================================"
    echo "CDP TEST FAILED"
    echo "======================================"

    echo
    echo "Lightpanda container logs:"
    docker logs "$LIGHTPANDA_NAME"

    exit 1
fi