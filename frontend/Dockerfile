# 빌드 단계와 서빙 단계를 나눈다. 최종 이미지에는 dist와 nginx만 남고 node_modules·소스는 들어가지 않는다.
FROM node:22-alpine AS build

WORKDIR /app

# 소스만 바뀐 빌드에서 npm ci가 캐시에서 나오도록 매니페스트를 먼저 복사한다.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# tsc -b && vite build. 타입 오류가 하나라도 있으면 여기서 빌드가 멈춘다.
RUN npm run build


FROM nginx:1.27-alpine

# 정적 서빙과 /api·/ws 프록시를 한 오리진에서 낸다.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
