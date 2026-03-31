FROM node:22-alpine AS build

WORKDIR /app
# Install deps first (cache layer)
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
# Copy shared code (imported by ui via relative paths)
COPY shared/ /app-shared/shared/
# Copy ui source
COPY ui/ .
# Fix shared imports to work with Docker layout
RUN ln -s /app-shared/shared ../shared
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
