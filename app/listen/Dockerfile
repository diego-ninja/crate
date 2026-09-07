FROM node:22-alpine AS build

WORKDIR /app

# Copy shared UI package first (workspace dependency)
COPY shared/ui/ /app-shared/shared/ui/

# Install deps — strip @crate/ui from package.json (it's a local workspace
# package, not on npm) then install, then symlink it into node_modules.
COPY listen/package.json listen/package-lock.json* ./
RUN sed -i '/"@crate\/ui"/d' package.json && npm install --ignore-scripts --legacy-peer-deps --package-lock=false
RUN mkdir -p node_modules/@crate && ln -s /app-shared/shared/ui node_modules/@crate/ui

# Copy shared code (imported by listen via relative paths)
COPY shared/ /app-shared/shared/

# Copy listen source
COPY listen/ .

# Fix shared imports to work with Docker layout
RUN ln -s /app-shared/shared ../shared

# Symlink node_modules into shared/ui so its imports resolve react etc.
RUN rm -rf /app-shared/shared/ui/node_modules && ln -s /app/node_modules /app-shared/shared/ui/node_modules

ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE
# Skip tsc typecheck in Docker (CI handles it separately).
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
