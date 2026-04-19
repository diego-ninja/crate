FROM node:22-alpine AS build

WORKDIR /app
# Install deps first (cache layer)
COPY listen/package.json listen/package-lock.json* ./
RUN npm ci
# Copy shared code (imported by listen via relative paths)
COPY shared/ /app-shared/shared/
# Copy listen source
COPY listen/ .
# Fix shared imports to work with Docker layout
RUN ln -s /app-shared/shared ../shared
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
