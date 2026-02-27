FROM node:20-slim AS base
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/server.js"]
