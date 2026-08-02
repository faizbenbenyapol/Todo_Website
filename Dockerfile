FROM node:25-bookworm-slim AS dependencies

WORKDIR /app

# better-sqlite3 อาจไม่มี prebuilt binary สำหรับ Node patch รุ่นใหม่ จึงเตรียม fallback compiler ใน build stage
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:25-bookworm-slim

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN mkdir -p /app/data && chown -R node:node /app/data

VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Bangkok
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
