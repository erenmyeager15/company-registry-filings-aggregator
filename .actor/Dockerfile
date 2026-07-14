FROM apify/actor-node:20 AS builder

COPY package*.json ./
RUN npm --quiet set progress=false && npm ci --include=dev

COPY . ./
RUN npm run build

FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false && npm ci --omit=dev --omit=optional

COPY --from=builder /usr/src/app/dist ./dist

CMD ["npm", "start"]
