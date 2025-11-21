# how to run
# docker build -t arx-z-bionix-ui .
# docker run -it -p 8188:80 --rm --name arx-z-bionix-ui arx-z-bionix-ui


# build stage
FROM node:lts-alpine as build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:stable-alpine as production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8008
CMD ["nginx", "-g", "daemon off;"]
