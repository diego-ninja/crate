FROM node:22-alpine AS build

WORKDIR /app

# Copy shared UI package (workspace dependency)
COPY shared/ui/ /app-shared/shared/ui/

# Install deps — use workspace-aware install
COPY listen/package.json listen/package-lock.json* ./
RUN npm install --install-strategy=nested --ignore-scripts 2>/dev/null || npm install --legacy-peer-deps

# Copy shared code (imported by listen via relative paths)
COPY shared/ /app-shared/shared/

# Copy listen source
COPY listen/ .

# Fix shared imports to work with Docker layout
RUN ln -s /app-shared/shared ../shared
# Symlink @crate/ui into node_modules for workspace resolution
RUN mkdir -p node_modules/@crate && ln -s /app-shared/shared/ui node_modules/@crate/ui

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
