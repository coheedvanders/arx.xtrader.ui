#!/bin/bash
# Stop and remove any existing container
docker rm -f arx-z-bionix-ui 2>/dev/null

# Remove the existing image
docker rmi arx-z-bionix-ui 2>/dev/null

# Build a new image
docker build -t arx-z-bionix-ui .

# Run a new container
docker run -d -p 8188:80 --name arx-z-bionix-ui arx-z-bionix-ui