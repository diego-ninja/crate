FROM node:22-alpine AS build

WORKDIR /app
COPY app/site/package.json app/site/package-lock.json* ./
RUN npm ci
COPY app/site/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
