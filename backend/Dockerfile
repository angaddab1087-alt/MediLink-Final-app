FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
# Creates the tables (safe to repeat), loads demo data once, then starts the API.
CMD ["sh", "-c", "node dist/db/seed.js && node dist/main.js"]
