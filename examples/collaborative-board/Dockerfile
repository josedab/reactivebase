FROM node:20-slim AS base
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || npm install

COPY . .

EXPOSE 4000
CMD ["node", "--loader", "ts-node/esm", "server.ts"]
