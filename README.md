# loweve · 小放映厅 × 双人游戏舱

> 为异地恋两个人做的私人影视 / 游戏记录与双人 AI 推荐。
> A private movie, TV and all-platform game tracker with AI recommendations, built for two.

用顶部「影视｜游戏」按钮切换两个完全隔离的空间：影视侧记录各自看过、一起看过和想看的内容；游戏侧记录各自玩过、一起玩过和「想和你一起玩」。两个空间共享身份与设置，但业务数据和 AI 推荐历史互不混用。

---

## ✨ 特性

- **双人观影记录** —— 各自「看过」（打分 + 短评）、「一起看过」（双方评分 + 联合感想 + 日期），按年份排成横向时间线。
- **想看就一起看** —— 共享待看清单，按优先级排序，看完一键转「一起看过」。
- **AI 排片推荐** —— 基于你俩的看过 / 评分 / 短评 / 想看，用 LLM 生成推荐并附一句"为什么推给你们"；TMDB 校验过滤幻觉、避开已看/已避雷；也能输入自定义需求（如「90 分钟内的轻松治愈片」）。
- **多源评分** —— 电影 / 剧集走豆瓣、番剧走 Bangumi，兜底 TMDB；点评分徽章直达对应条目页。
- **双人游戏舱** —— 完整的「推荐 / 我的游戏 / 一起玩过 / 想和你一起玩 / 详情 / 编辑 / 回收站」界面，采用独立的深蓝黑、电青与紫色主题。
- **IGDB 全平台目录** —— 可搜索 GBA、Switch / Switch 2、历代 PlayStation / Xbox、PC 等新旧平台，自动带入发售时间、平台、玩法、封面和目录评分。
- **Steam 商店增强** —— IGDB 条目存在 Steam 版本时，自动补充简体中文资料、国区人民币现价/原价/折扣、全部及近 30 天好评率，无需 Steam API Key。
- **AI 推荐游戏** —— 默认只推荐已正式发售、适合两人共同游玩的真实游戏；抢先体验按未发售处理，纯单人和未发售作品仅在自定义需求明确提出时纳入。价格不作权重，不会因为昂贵或暂时没有报价而排除。
- **海报代理缓存** —— 所有外链海报经本站代理+缓存，访客无需梯子也能看。
- **双视角维护** —— 可切到对方视角代为录入。
- **设置页配置** —— LLM / TMDB / Bangumi 凭证在 UI 里改，存数据库、覆盖环境变量、运行时即时生效。

## 🧱 技术栈

- **后端**：TypeScript（tsx 运行，无构建步骤）· Node 20 · Express 4 · better-sqlite3（单文件 SQLite，WAL）· Mocha
- **前端**：TypeScript · Vue 3 · Vite · Pinia · vue-router
- **部署**：Docker（多阶段构建：先编译前端，再拷进后端镜像，由后端统一托管 SPA + API）

> 校验：`scripts/check.sh` 一键跑两端 lint + typecheck + 测试（本机无 node 也可，全程 docker）。
> 视觉回归：`scripts/visual-diff/run.sh baseline|verify`——隔离实例 + 截图像素对比（改样式前采基线、改完 verify 零差异；单轮约 8-10 分钟）。
> Docker 构建即门槛：两端 lint/测试不过则镜像构建失败。

## 🚀 快速开始

### Docker（推荐）

```bash
git clone <your-repo-url> loweve
cd loweve
cp .env.example .env                          # 至少填 TMDB 凭证
cp docker-compose.example.yml docker-compose.yml   # 默认映射 18083，可按需改
docker compose up --build
```

打开 http://localhost:18083

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
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | 游戏功能必填 | IGDB 全平台目录；来自 Twitch Developer Console 的 Confidential 应用 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 选填 | AI 推荐，任意 OpenAI 兼容端点；三项都填才启用，留空则推荐功能关闭 |
| `USER_A_NAME` / `USER_B_NAME` | 选填 | 两位用户的初始显示名（仅首次启动写入；之后可在设置页改） |
| `BANGUMI_USER_AGENT` | 选填 | 番剧评分请求的 User-Agent |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 选填 | 墙内访问 TMDB 时给外网请求挂代理（标准代理变量）；留空则全程直连 |
| `LOWEVE_PORT` / `LOWEVE_DATA_DIR` / `TZ` | 选填 | 端口 / 数据卷（SQLite + 海报缓存） / 时区 |

> LLM / TMDB / IGDB / Bangumi 凭证也可在 **设置 → 服务配置** 里改：存数据库、覆盖环境变量、改完即时生效，无需重启。
>
> IGDB 使用 Twitch Confidential 应用的 Client Credentials，只在服务器端换取并缓存 App Access Token。Steam 商店增强不需要凭证；当前仅对 Steam 版本读取中国区人民币报价。Nintendo 报价暂未接入。

### 🌐 墙内代理（可选）

墙内访问 TMDB / IGDB / Twitch 需要代理时，配置标准代理变量（留空则全程直连）：

```yaml
# docker-compose.yml
environment:
  - HTTPS_PROXY=http://你的代理地址:端口
  - HTTP_PROXY=http://你的代理地址:端口
  - NO_PROXY=cli-proxy-api,localhost,127.0.0.1   # 内网 LLM 端点务必排除
```

## 📊 数据来源

| 来源 | 用途 | 是否需要凭证 |
|---|---|---|
| **TMDB** | 影视元数据 + 搜索（一切的底层） | 需要（免费） |
| **豆瓣** | 电影 / 剧集评分，走公开 JSON 接口（`subject_suggest` + `rexxar`） | 无需 |
| **Bangumi** | 番剧评分，公开 API | 无需 |
| **IGDB** | 全平台游戏目录、平台发行信息、封面与目录评分 | Twitch Client ID + Secret |
| **Steam** | Steam 版本的国区价格、总评与近 30 天评测 | 无需 |

影视海报与 IGDB / Steam 游戏素材统一经本站 `/api/img` 代理 + 落盘缓存。

### 游戏数据规则

- IGDB 作为作品身份与跨平台目录，Steam 只是可选外部版本；DLC / Add-on / Expansion 可作为追加内容独立加入，版本、捆绑包、试玩版、原声带、工具和 MOD 不作为游戏内容加入。
- 「玩过」表示有过实际游玩体验，不要求通关；每人对每款游戏保留一条可编辑记录，共同游玩记录同样每款一条。
- 共同计划状态为 `pending / playing / done / dropped`。从计划首次添加共同游玩时，计划自动进入 `playing`，不会直接标记完成。
- 默认 AI 推荐排除抢先体验、未发售、纯单人及 Steam 多半差评或更低的作品；小样本不是硬门槛。缺少报价不影响推荐资格，只有用户明确限定预算时才按现有报价过滤。
- 不绑定 Steam 账户，也不导入库存和游玩时长。

## 📁 项目结构

```
shared/   前后端共享的 API 数据形状（types.ts 单一来源）
server/   Node + Express + SQLite —— REST API + 托管前端构建产物
  src/
    routes/      影视、设置、图片代理与回收站 API
    games/       独立游戏 CRUD、平台发行、报价适配、计划、回收站与 AI 推荐
    igdb/        IGDB 全平台目录与 Twitch Client Credentials client
    steam/       Steam 商店报价与公开评测 client
    tmdb|douban|bangumi|llm/   影视数据源与 LLM client
    recos/       影视 AI 推荐：gather → prompt → 校验 → 缓存
    settings.ts  运行时配置（DB 覆盖 env）
web/      Vue 3 SPA（影视空间 + 游戏空间 + 共享 Settings）
  src/
    styles/      tokens（设计令牌）/ base / primitives（跨页原语）；页面样式在各组件 scoped
    composables/ useReelDrum（放映机滚筒引擎）
    utils/       watchedDate / reelGroups（带 Vitest 行为锁定测试）
scripts/  check.sh（一键 lint+typecheck+测试，docker 化）· visual-diff/（截图对比验证器）
docker-compose.yml
```

## 📄 License

MIT（见 [LICENSE](LICENSE)）。

---

仅为两个人而做 · made for two.
