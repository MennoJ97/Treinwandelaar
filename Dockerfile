# Node 24 LTS ships node:sqlite, so there is no native database addon to compile.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/treinwandelaar.db \
    RAW_CACHE_DIR=/data/raw \
    PORT=3000
# Full node_modules (incl. tsx) so the same image can run `npm run ingest`.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY scripts ./scripts
COPY src/lib ./src/lib
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "build"]
