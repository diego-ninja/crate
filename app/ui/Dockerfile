FROM node:22-alpine AS build

WORKDIR /app

# Copy shared UI package first (workspace dependency)
COPY shared/ui/ /app-shared/shared/ui/

# Install deps — strip @crate/ui from package.json (it's a local workspace
# package, not on npm) then install, then symlink it into node_modules.
COPY ui/package.json ui/package-lock.json* ./
RUN sed -i '/"@crate\/ui"/d' package.json && npm install --ignore-scripts
RUN mkdir -p node_modules/@crate && ln -s /app-shared/shared/ui node_modules/@crate/ui

# Copy shared code (imported by ui via relative paths)
COPY shared/ /app-shared/shared/

# Copy ui source
COPY ui/ .

# Fix shared imports to work with Docker layout
RUN ln -s /app-shared/shared ../shared

# Symlink node_modules into shared/ui so its imports resolve react etc.
RUN ln -s /app/node_modules /app-shared/shared/ui/node_modules
# Skip tsc typecheck in Docker (CI handles it separately).
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
