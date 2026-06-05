# server/Dockerfile
# 多阶段：构建 web → 拷进 server → 运行。build context 为 repo 根。
FROM node:20-bookworm-slim AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/server
# 先装依赖（better-sqlite3 ^11 在 linux x64/arm64 + node20 有预编译二进制，slim 镜像无需编译工具）
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
# 再拷源码
COPY server ./
# 拷入 web 构建产物到 ../../web/dist（config.ts 的 paths.webDist 指向此处）
COPY --from=web-build /build/web/dist /app/web/dist
EXPOSE 18083
# 用 tsx 直接跑 TS（tsx 是 dependencies，--omit=dev 已装；start = tsx index.ts）
CMD ["npm", "start"]
