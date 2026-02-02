@echo off

:: Define variables for reuse
set IMAGE_NAME=choco-bot
set TAR_FILE=choco-bot.tar
set SERVER_USER=montecris_admin
set SERVER_IP=192.168.1.10
set REMOTE_DIR=~/docker-images
set DEPLOY_SCRIPT=deploy.sh

:: Remove the Docker image locally
echo Removing existing Docker image %IMAGE_NAME%
docker rmi %IMAGE_NAME%

:: Build the Docker image
echo Building image %IMAGE_NAME%
docker build -t %IMAGE_NAME% .

:: Save the Docker image as a tar file
echo Saving tar file %TAR_FILE% from image %IMAGE_NAME%
docker save -o %TAR_FILE% %IMAGE_NAME%

:: Remove the Docker image locally
echo Removing image %IMAGE_NAME%
docker rmi %IMAGE_NAME%

:: Transfer the tar file to the server
echo Transferring tar file %TAR_FILE% to server %SERVER_USER%@%SERVER_IP%
scp %TAR_FILE% %SERVER_USER%@%SERVER_IP%:%REMOTE_DIR%

:: Transfer the deploy.sh to the server
echo Transferring deploy.sh file to server %SERVER_USER%@%SERVER_IP%
scp %DEPLOY_SCRIPT% %SERVER_USER%@%SERVER_IP%:%REMOTE_DIR%

:: Remove local tar file
echo Removing local tar file %TAR_FILE%
del %TAR_FILE%

:: SSH to server and execute the deploy.sh script
echo SSH-ing to server %SERVER_USER%@%SERVER_IP% and executing %DEPLOY_SCRIPT%
ssh %SERVER_USER%@%SERVER_IP% "bash %REMOTE_DIR%/%DEPLOY_SCRIPT%"

:: Print a confirmation message
echo Docker container deployed on the server.
