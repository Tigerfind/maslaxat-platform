FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
# npm install, а не npm ci: package-lock.json фронтенда в .gitignore, поэтому в
# сборку он не попадает — `npm ci` без lock-файла падает с EUSAGE. Бэкенд свой
# lock коммитит и там ci остаётся.
RUN npm install --no-audit --no-fund

# Build arg: API URL for production (defaults to same-origin)
ARG REACT_APP_API_URL=
ENV REACT_APP_API_URL=$REACT_APP_API_URL

COPY . .
# Линтер в релизной сборке выключен: без lock-файла подтягиваются свежие
# eslint-плагины, несовместимые с eslint-config-react-app («Environment key
# jest/globals is unknown»), и сборка падает на конфиге, а не на коде.
# Линт и тесты гоняются локально/в CI до деплоя.
ENV DISABLE_ESLINT_PLUGIN=true
ENV CI=false
RUN npm run build

# Финальный слой — node, а не nginx: railway.json задаёт startCommand
# `npx serve -s build -l $PORT`, и он подменяет CMD образа. В nginx-образе нет
# ни node, ни /app/build, поэтому контейнер падал сразу после успешной сборки.
# nginx.conf оставлен в репозитории для docker-compose (локальный стек).
FROM node:18-alpine

WORKDIR /app
COPY --from=build /app/build ./build
RUN npm install -g serve

EXPOSE 3000

# $PORT приходит от Railway; локально по умолчанию 3000.
CMD ["sh", "-c", "serve -s build -l ${PORT:-3000}"]
