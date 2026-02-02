#!/bin/bash

# Define variables
HOST="192.168.1.10"
USER="montecris_admin"
PASSWORD="admin123"
IMAGE_NAME="choco-bot"
TAR_FILE="~/docker-images/choco-bot.tar"
CONTAINER_NAME="choco-bot"

# Stop and remove the old container
echo "Removing existing container. . ."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no $USER@$HOST "echo $PASSWORD | sudo -S docker rm -f $CONTAINER_NAME"

# Remove the old image
echo "Removing existing image. . ."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no $USER@$HOST "echo $PASSWORD | sudo -S docker rmi $CONTAINER_NAME"

# Load the new tar file into a Docker image
echo "Loading image from tar file. . ."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no $USER@$HOST "echo $PASSWORD | sudo -S docker load -i $TAR_FILE"

# Run a new container
echo "Running container. . ."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no $USER@$HOST "echo $PASSWORD | sudo -S docker run -d --name $CONTAINER_NAME --network migs_network -p 8008:80 $IMAGE_NAME:latest"

echo "Deployment completed successfully."
