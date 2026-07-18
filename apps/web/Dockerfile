# Stage 1: build the static bundle.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web
COPY apps/web apps/web
RUN npm run build --workspace apps/web

# Stage 2: Nginx serves the static files and reverse-proxies /api.
# Node exists only at build time; the runtime image is just Nginx + HTML.
FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
