# server/Dockerfile
# 多阶段：构建 web → 拷进 server → 运行。build context 为 repo 根。
FROM node:20-bookworm-slim AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web ./
# T17：types.ts 上移 shared/，web/src/types.ts 用 ../../shared 相对引用；
# WORKDIR 是 /build/web，故 shared 需落在 /build/shared 才能对上这层相对路径。
COPY shared /build/shared
RUN npm run lint && npm run test:run
RUN npm run build

# 部署门槛（server）：独立阶段全量装依赖 + lint/typecheck/test，通过后写标记文件。
# 该阶段臃肿的全量 node_modules 绝不进入 runtime；只有标记文件被 COPY 过去建立依赖边。
FROM node:20-bookworm-slim AS server-check
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server ./
# T17 顺手加上：T18 server 路由会以 ../../../shared 引用共享类型（server/src/routes → /app/shared）。
COPY shared /app/shared
RUN npm run lint && npm run typecheck && npm test && touch /tmp/.server-checked

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/server
# 先装依赖（better-sqlite3 ^11 在 linux x64/arm64 + node20 有预编译二进制，slim 镜像无需编译工具）
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
# 再拷源码
COPY server ./
# T17 顺手加上：runtime 用 tsx 直接跑 TS，T18 引入 shared 引用后运行时也需要这份文件在场。
COPY shared /app/shared
# 部署门槛：强制依赖 server-check。标记文件仅当 lint+typecheck+test 全过才存在；
# 门槛不过 → 此 COPY 失败 → 镜像出不来。文件 0 字节，不影响 runtime 层体积。
COPY --from=server-check /tmp/.server-checked /tmp/.server-checked
# 拷入 web 构建产物到 ../../web/dist（config.ts 的 paths.webDist 指向此处）
COPY --from=web-build /build/web/dist /app/web/dist
EXPOSE 18083
# 用 tsx 直接跑 TS（tsx 是 dependencies，--omit=dev 已装；start = tsx index.ts）
CMD ["npm", "start"]
