#!/usr/bin/env bash
# 截图对比验证器。
#   run.sh baseline   —— 用当前代码建镜像、冻结一份数据快照、起隔离实例、截基准图 → baselines/
#   run.sh verify     —— 复用 baseline 时冻结的同一份数据快照（重点：不是重新从线上库拷贝！），
#                         起隔离实例、截新图 → .tmp/current，与 baselines/ 按「LSB 容忍带」对比
#                         （Δ≤2 且 ≤256px 判光栅噪声放行，其余一律拦——详见 compare.py 头注）
#
# 为什么 verify 不能每次都重新拷线上库：这工具要管的是「代码变了、画面有没有变」，只有
# baseline 和 verify 用同一份数据，差异才纯粹来自代码。线上库是这对夫妻在实际用的库，
# 重构期间随时可能新增/编辑记录——如果每次 verify 都重新拷最新数据，画面差异就会被数据
# 变化和代码变化混在一起，验证器会不断假阳性报警，直接失去意义。所以数据快照只在
# baseline 时冻结一次，之后所有 verify 永远复用那一份，直到手动重新采基线。
set -euo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:?用法: run.sh baseline|verify}"
VD=scripts/visual-diff
NET=loweve-verify-net
FROZEN_DATA="$VD/baselines/.data-snapshot"   # 随基线一起冻结/复用，baselines/ 已在 .gitignore 里整目录排除

# .env 的 LOWEVE_DATA_DIR 优先，否则 ./data
DATA_SRC=$(grep -E '^LOWEVE_DATA_DIR=' .env 2>/dev/null | cut -d= -f2- || true)
DATA_SRC="${DATA_SRC:-./data}"

cleanup() {
  docker rm -f loweve-verify loweve-hshell >/dev/null 2>&1 || true
  # 快照临时文件的清理挪到这里（而不是紧跟在生成它的那行代码后面）：这样不管脚本是正常
  # 走完、中途报错退出、还是被 Ctrl-C 打断，trap 在 EXIT 时都保证会跑到，线上库目录里都
  # 不会遗留这个临时文件。仅当 loweve（线上容器）还在跑时才尝试删——它没在跑就没有这个文件。
  if docker ps --format '{{.Names}}' | grep -qx loweve; then
    docker exec loweve rm -f /data/.verify-snapshot.db 2>/dev/null || true
  fi
}
trap cleanup EXIT
cleanup

echo '── 构建 loweve:verify ──'
docker build -q -t loweve:verify -f server/Dockerfile .

rm -rf "$VD/.tmp/data"; mkdir -p "$VD/.tmp/data"

if [ "$MODE" = baseline ]; then
  echo "── 冻结数据快照（源: $DATA_SRC，绝不写回；之后所有 verify 复用这份，不再碰线上库）──"
  rm -rf "$FROZEN_DATA"; mkdir -p "$FROZEN_DATA"
  if docker ps --format '{{.Names}}' | grep -qx loweve; then
    # {readonly: true}：这是这对夫妻在用的线上库，任何情况下都不该被这个验证工具写入。
    # better-sqlite3 的 backup API 兼容只读源连接——用只读句柄读出页面备份到新文件，不需要
    # 也不会对 loweve.db 本身产生写操作。备份出的临时文件交给上面的 cleanup trap 统一清理。
    docker exec loweve node -e "const p=require('better-sqlite3')('/data/loweve.db', {readonly: true}).backup('/data/.verify-snapshot.db'); p.then(()=>console.log('snapshot ok')).catch(e=>{console.error(e);process.exit(1)})"
    cp "$DATA_SRC/.verify-snapshot.db" "$FROZEN_DATA/loweve.db"
  else
    cp "$DATA_SRC"/loweve.db* "$FROZEN_DATA/" 2>/dev/null || true
  fi
  cp -r "$DATA_SRC/posters" "$FROZEN_DATA/posters" 2>/dev/null || mkdir -p "$FROZEN_DATA/posters"
else
  [ -d "$FROZEN_DATA" ] || { echo "找不到冻结的数据快照：$FROZEN_DATA。先跑一次 './run.sh baseline'。"; exit 1; }
fi
cp -r "$FROZEN_DATA/." "$VD/.tmp/data/"

echo '── 起隔离实例（内部网络，断外网）──'
docker network inspect $NET >/dev/null 2>&1 || docker network create --internal $NET
docker run -d --rm --name loweve-verify --network $NET \
  -v "$PWD/$VD/.tmp/data":/data -e LOWEVE_DATA_DIR=/data -e TZ=Asia/Shanghai loweve:verify
# --shm-size：Docker 默认 /dev/shm 只有 64M，headless-shell 靠共享内存搬运合成用的纹理，
# 64M 撞上稍复杂点的页面（比如海报网格多几张图）就会触发 GPU 共享内存分配失败——表现为
# Page.captureScreenshot 挂起甚至卡死整个浏览器进程，实测把 shm 调到 1g 后稳定复现不再出现。
# 追加 --disable-checker-imaging：禁用 Skia 的分级/棋盘式图片光栅（checker imaging），钉死海报
# 缩放走单一重采样路径——终审实测 /me 首行海报会以多个离散重采样变体渲染（模式间差 9 万像素级），
# 它是共识机制反复重掷的根因。注意：只传这一个 flag。镜像的 entrypoint 包装脚本会自带
# --remote-debugging-address/-port 并用 socat 做 9222 转发，重复传会让 Chrome 直接抢占 9222、
# socat 绑定失败，宿主侧 CDP 就再也连不上（踩过）。CMD 参数会被包装脚本追加给 headless-shell。
docker run -d --rm --name loweve-hshell --shm-size=1g -p 127.0.0.1:9223:9222 chromedp/headless-shell:latest \
  --disable-checker-imaging
docker network connect $NET loweve-hshell

echo '── 等应用就绪 ──'
for i in $(seq 1 30); do
  docker exec loweve-verify node -e \
    "require('http').get('http://127.0.0.1:18083/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
    && break || sleep 1
  [ "$i" = 30 ] && { echo '应用起不来'; docker logs loweve-verify | tail -20; exit 1; }
done
sleep 2

if [ "$MODE" = baseline ]; then
  # 只清旧 PNG，不能 rm -rf 整个 baselines/——上面刚冻的 .data-snapshot 也在这目录下面，
  # 一把梭会连数据快照一起删掉，verify 就没有稳定数据可复用了。
  rm -f "$VD"/baselines/*.png; mkdir -p "$VD/baselines"
  python3 "$VD/capture.py" --out "$VD/baselines"
  echo "✅ 基准已存 $VD/baselines"
else
  rm -rf "$VD/.tmp/current" "$VD/.tmp/diff"; mkdir -p "$VD/.tmp/current"
  python3 "$VD/capture.py" --out "$VD/.tmp/current"
  python3 "$VD/compare.py" "$VD/baselines" "$VD/.tmp/current" "$VD/.tmp/diff"
fi
