FROM node:24-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# generated/ is gitignored (derived from schema.prisma, not committed) -
# regenerate the real client for this environment before the app can start
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5002) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# named volumes get root ownership by default unless the mount point already
# exists (with the right owner) in the image beforehand - both uploads/ and
# .cache/models/ get volume-mounted in docker-compose, so the non-root `node`
# user needs write access to them created up front
RUN mkdir -p /app/uploads /app/.cache/models && chown -R node:node /app/uploads /app/.cache/models

USER node

CMD ["node", "src/index.js"]
