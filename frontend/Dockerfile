FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
# Lock-файл коммитится и проверяется CI, поэтому production собирается из того же дерева.
RUN npm ci --no-audit --no-fund

# Build arg: API URL for production (defaults to same-origin)
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT
ENV VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE

COPY . .
# Линт и тесты выполняются в CI до production-сборки.
RUN npm run build

# Финальный слой запускает статическую SPA на Railway PORT.
FROM nginx:1.27-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.railway.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=3000

EXPOSE 3000

# $PORT приходит от Railway; локально по умолчанию 3000.
CMD ["nginx", "-g", "daemon off;"]
