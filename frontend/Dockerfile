FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Static files are served by Caddy, which also proxies /routes to the backend
FROM caddy:2-alpine

COPY --from=build /app/dist /srv
