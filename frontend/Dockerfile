FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Vite inlines import.meta.env.* into the JS bundle at build time, not runtime -
# this has to be the browser-reachable API address (the host-published port),
# not the in-Docker-network service name like http://api:5002
ARG VITE_API_URL=http://localhost:5002
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM node:24-slim

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 5173

# -s enables SPA fallback (unmatched routes serve index.html) - required for
# react-router-dom's client-side routes to work on a direct URL hit/refresh
CMD ["serve", "-s", "dist", "-l", "5173"]
