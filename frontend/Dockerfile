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
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
