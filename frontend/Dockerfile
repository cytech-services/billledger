FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
# Skip postinstall (nuxt prepare) during install; build runs explicitly later.
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
