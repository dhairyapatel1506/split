# Stage 1: install everything (incl. dev deps) and compile TypeScript.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api
COPY apps/api apps/api
RUN npm run build --workspace apps/api

# Stage 2: production-only dependencies + compiled output. The dev
# toolchain (typescript, tsx, vitest) never reaches the final image.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --omit=dev
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations

WORKDIR /app/apps/api
EXPOSE 3000
# Run as the unprivileged user the base image ships with.
USER node
CMD ["node", "dist/server.js"]
