#!/bin/bash

CHROMIUM_NAME="chromium"
CDP_NAME="chromium-cdp"

CHROMIUM_IMAGE="linuxserver/chromium:version-6ae43f81@sha256:da269d40b655eb25ca0cd17c87f2e8e34b5b21f3e3eb14143746e40c62cb6951"

SERVER_IP="192.168.1.100"

echo "======================================"
echo "Starting Chromium"
echo "======================================"

# Remove old containers
docker rm -f "$CDP_NAME" 2>/dev/null
docker rm -f "$CHROMIUM_NAME" 2>/dev/null

# --------------------------------------------------
# Start Chromium
# --------------------------------------------------

docker run -d \
    --name "$CHROMIUM_NAME" \
    --hostname "$CHROMIUM_NAME" \
    --restart unless-stopped \
    -p 3001:3001 \
    -p 9222:9222 \
    -p 9223:9223 \
    --shm-size 1gb \
    -e "CHROME_CLI=--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0" \
    -e "PGID=1000" \
    -e "PUID=1000" \
    -e "TZ=Etc/UTC" \
    "$CHROMIUM_IMAGE"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to start Chromium."
    exit 1
fi

echo
echo "Chromium container started."
echo


# --------------------------------------------------
# Wait for container
# --------------------------------------------------

echo "Waiting for Chromium container..."

while true; do

    STATUS=$(docker inspect \
        -f '{{.State.Status}}' \
        "$CHROMIUM_NAME" 2>/dev/null)

    if [ "$STATUS" = "running" ]; then
        echo "Chromium container is running."
        break
    fi

    sleep 1
done


# --------------------------------------------------
# Show Chromium logs
# --------------------------------------------------

echo
echo "======================================"
echo "Chromium logs"
echo "======================================"

sleep 5

docker logs "$CHROMIUM_NAME"


# --------------------------------------------------
# Start CDP bridge
# --------------------------------------------------

echo
echo "======================================"
echo "Starting CDP bridge"
echo "======================================"

docker run -d \
    --name "$CDP_NAME" \
    --network "container:$CHROMIUM_NAME" \
    --restart unless-stopped \
    alpine/socat:latest \
    TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 \
    TCP:127.0.0.1:9222

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to start CDP bridge."
    exit 1
fi

echo
echo "CDP bridge started."
echo


# --------------------------------------------------
# Wait a little for CDP
# --------------------------------------------------

sleep 3


# --------------------------------------------------
# Final CDP test
# --------------------------------------------------

echo "======================================"
echo "Testing CDP"
echo "======================================"

echo
echo "curl http://$SERVER_IP:9223/json/version"
echo

curl "http://$SERVER_IP:9223/json/version"

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
    echo "CDP container logs:"
    docker logs "$CDP_NAME"

    exit 1
fi