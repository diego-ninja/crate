FROM node:22-alpine AS build

WORKDIR /app
COPY app/site/package.json app/site/package-lock.json* ./
RUN npm ci
COPY app/site/ .
COPY app/shared/ /shared/
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY install.sh /usr/share/nginx/html/install.sh
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
