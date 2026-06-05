# loweve · 小放映厅

> 为异地恋两个人做的私人影视记录 + AI 共看推荐。
> A tiny private movie/TV tracker with AI "what should we watch together tonight" recommendations, built for two.

记录你们各自看过、一起看过、想一起看的影视，自动带上豆瓣 / Bangumi 评分，并用 LLM 基于你俩的全部口味历史每天排一榜「今晚为你们排片」。

---

## ✨ 特性

- **双人观影记录** —— 各自「看过」（打分 + 短评）、「一起看过」（双方评分 + 联合感想 + 日期），按年份排成横向时间线。
- **想看就一起看** —— 共享待看清单，按优先级排序，看完一键转「一起看过」。
- **AI 排片推荐** —— 基于你俩的看过 / 评分 / 短评 / 想看，用 LLM 生成推荐并附一句"为什么推给你们"；TMDB 校验过滤幻觉、避开已看/已避雷；也能输入自定义需求（如「90 分钟内的轻松治愈片」）。
- **多源评分** —— 电影 / 剧集走豆瓣、番剧走 Bangumi，兜底 TMDB；点评分徽章直达对应条目页。
- **海报代理缓存** —— 所有外链海报经本站代理+缓存，访客无需梯子也能看。
- **双视角维护** —— 可切到对方视角代为录入。
- **设置页配置** —— LLM / TMDB / Bangumi 凭证在 UI 里改，存数据库、覆盖环境变量、运行时即时生效。

## 🧱 技术栈

- **后端**：Node 20 · Express 4 · better-sqlite3（单文件 SQLite，WAL）· Mocha
- **前端**：Vue 3 · Vite · Pinia · vue-router
- **部署**：Docker（多阶段构建：先编译前端，再拷进后端镜像，由后端统一托管 SPA + API）

## 🚀 快速开始

### Docker（推荐）

```bash
git clone <your-repo-url> loweve
cd loweve
cp .env.example .env        # 至少填 TMDB 凭证
docker compose up --build
```

打开 http://localhost:18083

> 用反向代理（如 Nginx Proxy Manager）部署时，可加一个 `docker-compose.override.yml` 去掉端口映射、接入你的代理网络。

### 本地开发

```bash
# 后端（:18083）
cd server && npm install && npm start

# 前端（另开终端，Vite dev server 把 /api 代理到后端）
cd web && npm install && npm run dev
```

### 测试

```bash
cd server && npm test
```

## ⚙️ 配置

首次启动前 `cp .env.example .env`：

| 变量 | 必填 | 说明 |
|---|---|---|
| `TMDB_API_TOKEN` / `TMDB_API_KEY` | ✅ 其一 | 影视检索 + 元数据。免费申请：<https://www.themoviedb.org/settings/api>（v4 Bearer token 优先，否则填 v3 key） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 选填 | AI 推荐，任意 OpenAI 兼容端点；三项都填才启用，留空则推荐功能关闭 |
| `USER_A_NAME` / `USER_B_NAME` | 选填 | 两位用户的初始显示名（仅首次启动写入；之后可在设置页改） |
| `BANGUMI_USER_AGENT` | 选填 | 番剧评分请求的 User-Agent |
| `LOWEVE_PORT` / `LOWEVE_DATA_DIR` / `TZ` | 选填 | 端口 / 数据卷（SQLite + 海报缓存） / 时区 |

> LLM / TMDB / Bangumi 凭证也可在 **设置 → 服务配置** 里改：存数据库、覆盖环境变量、改完即时生效，无需重启。

## 📊 数据来源

| 来源 | 用途 | 是否需要凭证 |
|---|---|---|
| **TMDB** | 影视元数据 + 搜索（一切的底层） | 需要（免费） |
| **豆瓣** | 电影 / 剧集评分，走公开 JSON 接口（`subject_suggest` + `rexxar`） | 无需 |
| **Bangumi** | 番剧评分，公开 API | 无需 |

海报统一经本站 `/api/img` 代理 + 落盘缓存（白名单 `image.tmdb.org` / `lain.bgm.tv`）。

## 📁 项目结构

```
server/   Node + Express + SQLite —— REST API + 托管前端构建产物
  src/
    routes/      search / works / marks / sessions / plan / recos / settings / img …
    tmdb|douban|bangumi|llm/   各数据源 client
    recos/       AI 推荐：gather → prompt → 校验 → 缓存
    settings.js  运行时配置（DB 覆盖 env）
web/      Vue 3 SPA（Home / Together / Plan / Me / Work / Settings）
docker-compose.yml
```

## 📄 License

MIT（见 [LICENSE](LICENSE)）。

---

仅为两个人而做 · made for two.
