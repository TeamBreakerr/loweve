#!/usr/bin/env python3
"""对隔离实例的各页面截图。用法：
   capture.py --cdp http://127.0.0.1:9223 --base http://loweve-verify:18083 --out <dir>
CDP 直驱 chromedp/headless-shell；每个 state：设 cookie/localStorage → 冻结动画 → 等稳定 → 截图。"""
import argparse, base64, fnmatch, json, os, subprocess, time, urllib.request
from urllib.parse import urlparse
import websocket

HERE = os.path.dirname(os.path.abspath(__file__))
FREEZE_CSS = ("*,*::before,*::after{animation:none!important;transition:none!important;"
              "scroll-behavior:auto!important;caret-color:transparent!important}")
# index.html 引用 Google Fonts。宿主机跑着系统级透明代理（fake-ip 会把 fonts.googleapis.com
# 解析成 198.18.x.x 段再转发出去），hshell 容器又是双网（默认 bridge + 验证内网）—
# 靠“内网断外网”挡不住这条走 bridge 网卡的请求：实测它真的会在 ~0.4s 内连通并拿到
# 谷歌真实响应，字体便会从兜底字体切换成远程字体，两次抓拍时机不同就会引入像素差异，
# 偶尔还观察到它拖慢/卡住同一 target 上后续的 CDP 命令（截图曾整整挂起 60s）。
# 与其和宿主机的网络拓扑/代理规则纠缠，不如直接在浏览器这一层把这两个域名的请求拦死——
# 不管宿主网络/代理今天什么状态，结果都保证一致。这是第一道防线，在 Network 域生效，比
# Fetch 域拦截更早更硬（连接都不让发起），但只挡这两个已知域名；覆盖任意域名的第二道
# 默认拒绝兜底见 serialize_image_loads()。
BLOCKED_URL_PATTERNS = ['*fonts.googleapis.com*', '*fonts.gstatic.com*']
# 根因排查记录（重要，别删）：海报图（有损照片内容）多图并发加载的页面（尤其 /me 16 张海报网格）
# 在两次独立截图之间会有零星 ±1～几个 LSB 的像素噪声。排查顺序：
#   1. 怀疑 settle() 判定"就绪"过早——证伪：对已稳定的页面连续截 4 张，字节完全相同，
#      说明合成器本身确定性没问题。
#   2. 怀疑是"没等够"——证伪：固定等 10 秒后，开 3 个全新 tab 各自截图，字节互不相同；
#      同一个 tab 反复重新导航，4 次里也有 1 次跟别的不一样——等多久都没用。
#   3. 怀疑是多核调度竞争——证伪：把容器钉死单核（--cpuset-cpus=0）问题依旧。
#   4. 怀疑是网络到达时序造成并发解码——证伪：严重限流网络问题依旧。
#   5. 怀疑是 image-rendering 插值算法本身——部分为真：改成 pixelated（最近邻，无加权求和）
#      能把噪声压低约 4 个数量级，但压不到零。
#   6. 直接验证："并发"才是触发条件：用 Fetch 域把图片响应按到达顺序逐张 continueResponse
#      （上一张的 Network.loadingFinished/Failed 到了才放下一张），同一页面连续 3 次独立开
#      tab 截图字节完全一致；不做串行化则必现差异。
# 结论：这是 swiftshader 软件光栅化在 ARM64 上并发处理多张有损图片时的真实数据竞争（日志能
# 看到 "Attempt to read from an uninitialized SharedImage" 这类提示），不是页面代码的问题，
# 也不是等待时机的问题——但既然"并发"是触发条件，就用 CDP 把并发去掉：见 serialize_image_loads()。
# 这份清单现在由 serialize_image_loads() 里的 _is_image_url() 用 fnmatch 在 Python 侧比对，
# 不再直接喂给 CDP 的 Fetch.enable patterns——Fetch.enable 现在拦一切响应阶段请求（默认拒绝
# 非应用域名 + 图片才串行化，其余立即放行），图片判定挪到这边做。
IMAGE_URL_PATTERNS = ['*/api/img*', '*/api/posters/*', '*.jpg', '*.jpeg', '*.png', '*.webp', '*.gif', '*.svg']
# 根因排查再补一条（重要，别删）：光按 Network.loadingFinished 到达顺序逐张放行，在本机这种
# 容器到容器、往返时间亚毫秒级的网络环境下不够用——"网络数据到齐"和"解码+光栅+合成完成"是
# 两件事，后者（尤其 swiftshader 软件路径处理有损照片）耗时明显长于前者：下一张的字节前脚到、
# 上一张的解码后脚可能还没收尾，两个解码就在时间上重叠了，同一个坑，只是从"网络并发"移到了
# "解码并发"。而且部分海报是用 CSS background-image 画的（见 TogetherReel.vue 的胶片预览格），
# 根本没有 <img>.complete 这种能从 JS 侧查询"解码完了没"的信号，没法靠轮询真实完成状态来放行
# 下一张。只能退而求其次：放行下一张前先扎实等一段墙钟时间，把这段时间让给上一张解码收尾。
# 用固定间隔实测过（0.1s/0.5s），概率会降但压不到零，一路揪出真正原因：数据库里绝大多数海报
# 是 /api/img 代理转存的小图（92×~130，几 KB～十几 KB，baseline JPEG，解码几乎不耗时），但
# 有一张"乒乓"的封面是 856×1200、146KB 的 progressive JPEG——比其它海报大一到两个数量级，
# progressive 格式还需要多轮扫描才能出完整图像，解码本身就慢得多，固定小间隔完全不够、加到
# 0.5s 依然能复现，换成大间隔又会拖慢其余几十张小图。用 Network.loadingFinished 自带的
# encodedDataLength（响应体大小）区分：小图维持一个够用的小间隔，体积明显异常的大图额外多
# 睡一截，专款专用，不用「一刀切」的大间隔拖累整体耗时。
DECODE_SETTLE_GAP = 0.2          # 绝大多数几 KB～十几 KB 小海报够用的基础间隔
DECODE_SETTLE_GAP_LARGE = 3.0    # 响应体超过下面这个阈值的大图，额外多等的间隔
DECODE_SETTLE_LARGE_BYTES = 50_000

def _is_image_url(url):
    """URL 是否匹配上面的图片清单。CDP 的 urlPattern 匹配会先掐掉 query string 再比较，这里
       同样处理，否则 image.jpg?w=200 这种会被 *.jpg 判定漏掉。"""
    path = url.split('?', 1)[0]
    return any(fnmatch.fnmatch(path, p) for p in IMAGE_URL_PATTERNS)

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cdp', default='http://127.0.0.1:9223')
    ap.add_argument('--base', default='http://loweve-verify:18083')
    ap.add_argument('--out', required=True)
    ap.add_argument('--hshell-container', default='loweve-hshell',
                     help='浏览器容器名，撞上崩溃需要整容器重启时用（docker restart）')
    return ap.parse_args()

class CDP:
    def __init__(self, http_url, connect_timeout=15, ws_timeout=20):
        self.http_url = http_url
        self.ws_timeout = ws_timeout
        self._id = 0
        self._connect(connect_timeout)
    def _connect(self, connect_timeout):
        # hshell 容器刚起来（或刚重启）时 CDP HTTP 端点可能还没监听，重试而非死等固定 sleep。
        deadline = time.time() + connect_timeout
        ver = None
        while time.time() < deadline:
            try:
                ver = json.load(urllib.request.urlopen(self.http_url + '/json/version', timeout=2))
                break
            except Exception:
                time.sleep(0.3)
        if ver is None:
            raise RuntimeError(f'连不上 CDP：{self.http_url}/json/version（等了 {connect_timeout}s）')
        self.ws = websocket.create_connection(ver['webSocketDebuggerUrl'], timeout=self.ws_timeout, suppress_origin=True)
    def reconnect(self, connect_timeout=30):
        """整个浏览器容器重启后用：原连接多半已经死透，直接丢弃重连一条新的。"""
        try: self.ws.close()
        except Exception: pass
        self._connect(connect_timeout)
    def send(self, method, params=None, session=None):
        self._id += 1
        msg = {'id': self._id, 'method': method}
        if params: msg['params'] = params
        if session: msg['sessionId'] = session
        self.ws.send(json.dumps(msg))
        return self._id
    def wait(self, id_):
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == id_:
                if 'error' in m: raise RuntimeError(f"CDP error: {m['error']}")
                return m.get('result', {})
    def call(self, method, params=None, session=None):
        return self.wait(self.send(method, params, session))

def evaljs(cdp, sid, expr):
    r = cdp.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True}, session=sid)
    if r['result'].get('subtype') == 'error':
        raise RuntimeError('page js error: ' + str(r['result'].get('description')))
    return r['result'].get('value')

def settle(cdp, sid, timeout=20):
    """等 readyState=complete + 所有 <img> 完成 + 两帧 raf + 600ms 静置。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        ok = evaljs(cdp, sid,
            "document.readyState==='complete' && Array.from(document.images).every(i=>i.complete)")
        if ok: break
        time.sleep(0.3)
    evaljs(cdp, sid, "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    time.sleep(0.6)

def serialize_image_loads(cdp, sid, base, timeout=15, quiet=1.2, initial_grace=2.5):
    """事件泵：接管这个 session 的 Fetch 拦截（自己 enable、自己 disable），干两件事：
    1) 默认拒绝一切非应用自身域名的请求（Fetch.failRequest）。hshell 是双网容器（bridge 有
       真外网），BLOCKED_URL_PATTERNS/setBlockedURLs（见文件顶部）只挡两个已知字体域名，
       这里是覆盖任意域名的第二道兜底——不管宿主网络/代理/未来页面新引入什么外部资源，跨域
       请求一律不放行。
    2) 应用自身域名下匹配 IMAGE_URL_PATTERNS 的图片响应，按到达顺序逐张放行——上一张的
       Network.loadingFinished/loadingFailed 到了才 continueResponse 下一张，避免同屏多图
       并发解码触发 swiftshader 的数据竞争（见文件顶部根因排查记录）。应用自身域名下的非
       图片请求（HTML/JS/CSS/API）不需要串行化，立刻放行——毕竟现在拦的是「一切」，这类
       请求不赶紧放行会白白拖慢页面加载。
    两套 requestId 不是一回事，这是本函数最早版本踩过的坑：Fetch.requestPaused 里的
    requestId 属于 Fetch 拦截命名空间（形如 interception-job-23.0），只能喂给
    Fetch.continueResponse/failRequest；Network.loadingFinished/loadingFailed 报的
    requestId 属于 Network 命名空间（形如 57.x），两边数值完全不通用——拿前者去匹配后者，
    命中率是 0，队列永远不流动，每页烧满 timeout 才 fallback 并发放行全部图片，恰好是这个
    函数想防的竞争条件本身。CDP 在 Fetch.requestPaused 事件里额外带了 networkId 字段做
    桥接——它就是这个请求对应的 Network 命名空间 requestId，专门用来匹配
    loadingFinished/Failed。个别请求没有 networkId（极少数非网络请求）：没法用它做串行化
    匹配，直接放行、不进队列。
    必须在 Page.navigate 之后调用，且每次 navigate、每次点击动作之后都要调用一次——否则
    被拦的请求永远不会被放行，settle() 会一直等不到 img.complete。Fetch.enable 放在这个
    函数开头做而不是像以前那样在 new_page() 里 enable 一次就长期开着：函数退出前必然
    Fetch.disable，不让拦截在两次调用之间的空档（settle/截图阶段）悬挂——万一那期间有零星
    请求被拦下却没人读 socket 去放行，会一直卡着。下次调用本函数会重新 enable。
    用裸 socket 收发（不走 cdp.call/wait），因为这里要处理的是异步事件流，不是一问一答；
    Fetch.enable 本身也用 send 不用 call——如果用同步 call 等它的 ack，万一 ack 到达前就有
    Fetch.requestPaused 插进来，会被 cdp.wait() 当噪声吞掉（它只认 id 匹配的那条回复，其余
    一律丢弃），这个请求就没人放行了；改成 send 后，ack 和所有事件都由下面这个循环自己按
    到达顺序处理——ack 本身没有 method 字段，会被安全地跳过。"""
    app_host = urlparse(base).hostname
    pending = []       # [(fetch_id, network_id), ...] 图片请求，从没发过 continueResponse
    current = None     # (fetch_id, network_id)：当前已放行、正等它 loadingFinished/Failed 的一对
    seen_any = False
    start = time.time()
    last_event = start
    deadline = start + timeout
    old_timeout = cdp.ws_timeout
    cdp.ws.settimeout(0.3)
    try:
        cdp.send('Fetch.enable', {'patterns': [{'urlPattern': '*', 'requestStage': 'Response'}]}, session=sid)
        while time.time() < deadline:
            try:
                raw = cdp.ws.recv()
            except Exception:
                now = time.time()
                if not seen_any and (now - start) > initial_grace:
                    return   # 这页压根没有网络活动，别傻等到 timeout
                if seen_any and not pending and current is None and (now - last_event) > quiet:
                    return   # 图片队列清空，且有一阵子没有任何新请求了，提前收工
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            method = m.get('method')
            params = m.get('params') or {}
            if method != 'Fetch.requestPaused':
                if method in ('Network.loadingFinished', 'Network.loadingFailed'):
                    # 排队中的请求也可能被页面取消（loadingFailed）：不剔除的话，轮到它时
                    # continueResponse 会对着已死的拦截报错被吞，泵就只能干等一个永不再来的
                    # 完成事件直到超时——它是轮次时长波动的放大器之一（终审 Important #3）。
                    if method == 'Network.loadingFailed':
                        rid = params.get('requestId')
                        pending[:] = [pq for pq in pending if pq[1] != rid]
                    if current is not None and params.get('requestId') == current[1]:
                        # 见文件顶部 DECODE_SETTLE_GAP 旁的根因排查记录——网络数据到齐不等于
                        # 解码/光栅/合成收尾，这里睡一下，把这段时间让给刚放行那张的解码收尾。
                        # 响应体大小从 loadingFinished 自带的 encodedDataLength 拿
                        # （loadingFailed 没有这个字段，.get 缺省成 0，自然落进「小图」的基础
                        # 间隔，反正失败的请求也没有解码工作要等）。注意这个 sleep 对「队列里
                        # 最后一张」同样要生效，不能只在还有下一张待放行时才睡——最后一张之后
                        # 紧跟着的是 settle()，如果这里不等，等于让它带着还没收尾的解码工作
                        # 就退出本函数，settle() 那点固定静置时间不一定兜得住（尤其是这种大图，
                        # 后面 settle() 判定"完成"之后如果紧接着有点击动作打开弹窗，弹窗里如果
                        # 复用了同一张图——常见于同一条记录在列表卡片和编辑弹窗缩略图里都出现
                        # ——会走浏览器内的资源去重，不会再触发一次 Fetch.requestPaused，也就
                        # 绕开了这整套串行化，所以更要保证第一次渲染这张图时就把解码彻底等完，
                        # 不留尾巴给后面这种拿不到 CDP 事件钩子的复用场景去踩。阻塞这个 while
                        # 循环不读 socket 没关系：TCP/websocket 会把这期间到达的消息缓冲住，
                        # 睡醒后照样能收到，不会丢消息（真正会丢消息的是 cdp.wait() 那种「只认
                        # 目标 id、其余丢弃」的用法，这里没用它）。
                        size = params.get('encodedDataLength', 0)
                        gap = DECODE_SETTLE_GAP_LARGE if size > DECODE_SETTLE_LARGE_BYTES else DECODE_SETTLE_GAP
                        time.sleep(gap)
                        current = None
                        if pending:
                            nxt = pending.pop(0)
                            cdp.send('Fetch.continueResponse', {'requestId': nxt[0]}, session=sid)
                            current = nxt
                        last_event = time.time()
                continue
            fetch_id = params.get('requestId')
            network_id = params.get('networkId')
            url = (params.get('request') or {}).get('url', '')
            seen_any = True
            last_event = time.time()
            if urlparse(url).hostname != app_host:
                # 默认拒绝：不是应用自身域名，不管是不是已知的字体域名，一律掐断。
                cdp.send('Fetch.failRequest', {'requestId': fetch_id, 'errorReason': 'BlockedByClient'}, session=sid)
            elif not network_id or not _is_image_url(url):
                # 应用自身的非图片请求（HTML/JS/CSS/API），或者是图片但没有 networkId 没法
                # 串行化匹配——都不需要排队，立刻放行。
                cdp.send('Fetch.continueResponse', {'requestId': fetch_id}, session=sid)
            elif current is None:
                cdp.send('Fetch.continueResponse', {'requestId': fetch_id}, session=sid)
                current = (fetch_id, network_id)
            else:
                pending.append((fetch_id, network_id))
        # 超时兜底：pending 里那些从没发过 continueResponse 的图片请求不能一直晾着，统一放行
        # ——正确性优先于「按队列顺序放完」，这里已经等了 timeout 秒。current 不在这个兜底
        # 之列：它早在被选中放行的那一刻就已经发过 continueResponse 了，重复对同一个
        # requestId 发第二次只会换来一条「Invalid InterceptionId」之类的 CDP 错误——而
        # cdp.send 是 fire-and-forget，这类错误会被直接吞掉、不会抛出，容易让人误以为兜底
        # 逻辑没问题（实际上是在无声地打水漂）。
        for fetch_id, _network_id in pending:
            cdp.send('Fetch.continueResponse', {'requestId': fetch_id}, session=sid)
    finally:
        cdp.ws.settimeout(old_timeout)
        cdp.send('Fetch.disable', session=sid)

def capture_stable(cdp, sid, required_streak=3, max_attempts=20, wait_between=0.4):
    """反复截图，直到连续 required_streak 张字节完全一致才采用。
       根因排查：图多的页面（如 /me 16 张海报网格）曾观察到同一次 shoot 里前后两次截图字节不同，
       且差异集中在照片内容、几乎全是 ±1 LSB 的浮点舍入噪声——怀疑是图片解码/缩放这类异步光栅
       工作在 settle() 判定"readyState + 所有 <img>.complete"之后仍有尾巴在跑。直接证据：对一个
       已经等了 3 秒、判定稳定的页面连续截 4 张图，字节完全相同——说明合成器本身是确定性的，
       问题只在于"我们判定就绪的时机"是否真的等到了最后一批异步光栅工作完成。与其去猜一个足够
       长的固定延时，或者用 image-rendering:pixelated 这类改变渲染观感的手段去掩盖，不如直接拿
       结果本身做判据。只要求连续两张一致时仍偶有漏网（说明还在缓慢收敛，凑巧撞上两张相邻相同
       但还没真正到终态）；连续三张字节完全一致，实测足以把这类残余噪声也摁下去。"""
    recent = []
    for attempt in range(1, max_attempts + 1):
        cur = cdp.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']
        recent.append(cur)
        if len(recent) >= required_streak and all(x == recent[-1] for x in recent[-required_streak:]):
            return recent[-1]
        time.sleep(wait_between)
    raise RuntimeError(f'截图 {max_attempts} 次都没能连续 {required_streak} 次保持一致，不敢采信')

def new_page(cdp, base, w, h, mobile):
    tid = cdp.call('Target.createTarget', {'url': 'about:blank'})['targetId']
    sid = cdp.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    cdp.call('Page.enable', session=sid)
    cdp.call('Network.enable', session=sid)
    # 根因排查补记（重要，别删）：光把「网络请求」串行化不够——/api/img 对外链海报吐
    # Cache-Control: public, max-age=31536000, immutable。同一张海报如果在同一页出现两次
    # （比如 /together 的胶片预览条 + 下面的会话卡片用的是同一条 session 数据）或者跨页复用
    # （这次跑的截图任务里，好几个 state 共享同一批 work 记录），第二次引用命中的是浏览器
    # HTTP 缓存——Chrome 对 immutable 缓存命中干脆不发真实网络请求，Fetch.requestPaused 压根
    # 不会触发，这类图片就绕过了 serialize_image_loads() 的串行队列，在不受控的时机解码，
    # 照样能撞上 swiftshader 并发解码的数据竞争（实测现象：某一张海报在 /me、/together、
    # 编辑弹窗等多处画面里同时出现一样的静态噪声花屏，且 baseline/verify 两轮结果不一致）。
    # 关掉这个 page 的 HTTP 缓存，逼每一次图片引用都走真实网络请求，才能保证「所有图片加载
    # 都会经过拦截+串行化」这个前提不被缓存命中悄悄破坏。
    cdp.call('Network.setCacheDisabled', {'cacheDisabled': True}, session=sid)
    cdp.call('Network.setBlockedURLs', {'urls': BLOCKED_URL_PATTERNS}, session=sid)
    # Fetch 域不在这里 enable。它现在拦一切响应阶段请求（默认拒绝非应用域名 + 图片才
    # 串行化，见 serialize_image_loads()），且只在该函数执行期间临时开启、退出前必然
    # disable，避免在两次调用之间的空档（settle/截图阶段）留下悬挂的拦截。每个从这里出去
    # 的 page 都必须紧跟着调用一次 serialize_image_loads()，否则该 page 后续所有网络请求
    # 都不会被处理，页面永远加载不完。
    cdp.call('Emulation.setDeviceMetricsOverride',
             {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': mobile}, session=sid)
    host = urlparse(base).hostname
    cdp.call('Network.setCookie', {'name': 'loweve_user_id', 'value': '1', 'domain': host, 'path': '/'}, session=sid)
    cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source':
        "try{localStorage.setItem('loweve.viewing','1')}catch(e){};"
        "document.addEventListener('DOMContentLoaded',()=>{"
        "const s=document.createElement('style');s.textContent=" + json.dumps(FREEZE_CSS) + ";"
        "document.head.appendChild(s);});"}, session=sid)
    return tid, sid

def wait_for_selector(cdp, sid, selector, timeout=5):
    """轮询等选择器出现（异步 fetch 灌数据后才挂载的元素，如 .card-edit）。找到返回 True。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if evaljs(cdp, sid, f"!!document.querySelector({json.dumps(selector)})"):
            return True
        time.sleep(0.15)
    return False

def restart_browser(container):
    # 撞崩的 renderer 在死循环里疯转，未必好好响应 SIGTERM；-t 3 把优雅退出的等待砍短，
    # 到点直接 SIGKILL，别让一次重启本身也拖成新的长挂起。
    subprocess.run(['docker', 'restart', '-t', '3', container], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

class PageLogicError(RuntimeError):
    """确定性的页面/数据逻辑错误（选择器怎么等都等不到、数据副本里压根没有需要的记录……）。
       跟 shoot_with_retry 要处理的浏览器/GPU 崩溃是两码事：崩溃是「这次运气不好，换个干净的
       renderer 再试大概率能过」，这类错误是「答案已经确定，重试一百次结果都一样」——重启
       浏览器容器换不来不同的选择器或不同的数据，只会白白浪费一轮重启的时间再报同样的错。"""

def shoot_with_retry(cdp, base, out_dir, state, vp_name, size, work_path, hshell_container, attempts=3):
    """chromedp/headless-shell 用 swiftshader 软件渲染，实测 Page.captureScreenshot 有小概率撞上
       GPU 命令缓冲区崩溃（日志：'GPU process exited unexpectedly' / 'AllocateRingBuffer() failed'）。
       这不是「崩了会自愈」的瞬时故障：撞上那一下的 renderer 进程会卡进一个失败重试的死循环
       （CPU 占用长期 100%+），既不会自己恢复，还会一直占着资源拖慢/拖死同浏览器进程里其它
       target 的 CDP 通信（哪怕开新连接、新 target 也救不回来，实测连接过一次全新 WebSocket
       依然超时）。唯一干净的恢复手段是把整个浏览器容器重启掉，换一个全新、没有僵尸进程的
       GPU/renderer 状态再重截——不是页面内容的问题，是这个浏览器版本+软件渲染组合的已知不稳定。
       但 PageLogicError 不属于这一类（见该类的说明），撞上就直接原样上抛，不消耗重启次数。"""
    last_exc = None
    for attempt in range(1, attempts + 1):
        try:
            shoot(cdp, base, out_dir, state, vp_name, size, work_path)
            return
        except PageLogicError:
            raise
        except Exception as e:
            last_exc = e
            label = f"{state['name']}--{vp_name}"
            if attempt < attempts:
                print(f'  ⚠ {label}: 第 {attempt}/{attempts} 次尝试失败（{e}），重启浏览器容器后重试', flush=True)
                restart_browser(hshell_container)
                cdp.reconnect()
            else:
                print(f'  ⚠ {label}: 第 {attempt}/{attempts} 次尝试失败（{e}），放弃', flush=True)
    raise RuntimeError(f"{state['name']}--{vp_name}: 连续 {attempts} 次截图失败（含浏览器重启重试）") from last_exc

def _load_and_capture(cdp, base, state, vp_name, size, work_path):
    """一次性：开新 page → 导航 → 走完这个 state 的动作 → 截图，返回 base64 PNG。不做任何
       "这个结果可信吗"的判断——判不判断、要不要整个重来是调用方 shoot() 的事，这里只管
       老老实实、独立地跑完一次完整加载。"""
    w, h = size
    tid, sid = new_page(cdp, base, w, h, vp_name == 'mobile')
    try:
        path = work_path if state['path'] == '__WORK__' else state['path']
        cdp.call('Page.navigate', {'url': base + path}, session=sid)
        serialize_image_loads(cdp, sid, base)
        settle(cdp, sid)
        for act in state.get('actions', []):
            if 'click' in act:
                # 目标元素可能要等页面的异步 fetch（如 sessions 列表）灌完数据才挂载，先轮询等它出现，
                # 而不是查一次就报「找不到」——那样会把「数据还没到」误判成「选择器写错了」。
                if not wait_for_selector(cdp, sid, act['click'], timeout=8):
                    raise PageLogicError(f"{state['name']}: selector not found (waited 8s): {act['click']}")
                found = evaljs(cdp, sid,
                    f"(()=>{{const el=document.querySelector({json.dumps(act['click'])});"
                    f"if(el){{el.click();return true}}return false}})()")
                if not found:
                    raise PageLogicError(f"{state['name']}: selector not found: {act['click']}")
                # 点击立刻接管拦截再消化 waitMs：setCacheDisabled 之下弹窗海报必然重新发请求，
                # 若等 waitMs 睡完才 enable，Fetch 在这个窗口是关的，图片请求会完全绕过串行化。
                serialize_image_loads(cdp, sid, base)
            if 'waitMs' in act:
                time.sleep(act['waitMs'] / 1000)
        serialize_image_loads(cdp, sid, base)   # 兜底：无点击动作的 state 此调用在 initial_grace 内即返
        settle(cdp, sid, timeout=8)
        return capture_stable(cdp, sid)
    finally:
        # target 若已经卡进崩溃死循环，close 也可能连不上；不让清理动作的失败掩盖真正的异常，
        # 反正撞上真崩溃时 shoot_with_retry 马上就要重启整个浏览器容器，这个 target 跟着一起没了。
        try:
            cdp.call('Target.closeTarget', {'targetId': tid})
        except Exception:
            pass

def lsb_equivalent(png_b64_a, png_b64_b, max_delta=1, max_px=128):
    """两次独立加载的截图是否「LSB 等价」：每通道差值 ≤max_delta 且差异像素数 ≤max_px。
       为什么不用字节全同：swiftshader 的矢量抗锯齿在两次完全独立的加载之间有不可归零的
       ±1 LSB 浮点舍入散布（实测繁忙页面可达几十像素）——拿字节全同当共识判据，busy 页面
       会永远达不成共识（实测 modal-add 连续 15 次加载没有任何两次全同）。而这个函数要拒绝
       的解码污染（SharedImage 数据竞争）是大面积、大差值的花屏，绝不可能落在 ≤1 LSB ×
       ≤128 像素的包络里——所以放行 LSB 噪声不会漏掉污染帧。"""
    import io
    from PIL import Image, ImageChops
    a = Image.open(io.BytesIO(base64.b64decode(png_b64_a))).convert('RGB')
    b = Image.open(io.BytesIO(base64.b64decode(png_b64_b))).convert('RGB')
    if a.size != b.size:
        return False
    diff = ImageChops.difference(a, b)
    if diff.getbbox() is None:
        return True
    if max(diff.getextrema(), key=lambda ch: ch[1])[1] > max_delta:
        return False
    n_px = sum(1 for p in diff.getdata() if p != (0, 0, 0))
    return n_px <= max_px

def shoot(cdp, base, out_dir, state, vp_name, size, work_path, majority_of=3, max_load_attempts=7):
    """截一个 state。整个"新开 page → 导航 → 截图"要重来最多 max_load_attempts 次，直到连续
       stable_streak 次相互独立的加载结果 **LSB 等价**（见 lsb_equivalent——不是字节全同，
       字节全同在跨加载的 ±1 LSB 抗锯齿噪声下对繁忙页面不可达成）才采信落盘。
       为什么不能只靠 capture_stable() 就够：capture_stable() 反复截的是同一次已经渲染完的
       页面——如果 swiftshader 并发解码的数据竞争已经把某张图的合成结果写花了，那个花掉的结果
       本身是稳定的（GPU 共享内存已经被那次读坏了，不会自己变回来），反复截图只会一遍遍截到
       同一张已经错的画面，"连续三次字节相同"照样能通过，但通过的是一个错误答案。文件顶部的
       根因排查早就证实过"等更久没用"（bullet 2：固定等 10 秒问题依旧）——废的画面不会自愈，
       必须让它重新解码一遍才有机会不撞上那次竞争，所以这里连 Page.navigate 都推倒重来，是
       全新的一次加载，不是重新截图。这跟 capture_stable() 是同一个哲学的延伸（拿结果本身做
       判据，而不是猜够不够稳、够不够久），只是把"求稳"这件事从"截图层"提到了"加载层"：
       DECODE_SETTLE_GAP 那套串行化+间隔已经把这个竞争的命中概率压得很低，但那终究是有限的
       固定间隔，理论上压不到绝对零——真随机的竞争条件不会连续两次完全独立的加载都撞上同一种
       错法，能稳定复现的结果就是没被竞争污染的真结果。"""
    label = f"{state['name']}--{vp_name}"
    # 众数共识：把每次独立加载按 LSB 等价归入等价类，某类率先攒到 majority_of 票即采信其代表帧。
    # 为什么不是「连续两次一致」：终审实测海报缩放存在多个离散重采样变体（多模态），连续判据
    # 遇到模式交替只能反复重掷甚至整轮中止，还留有「连续两次撞上少数模式 → 与基线不符 → 假红」
    # 的小概率路径；众数制下基线与验证两侧都收敛到同一个多数模式，确定性由统计保证。
    # （--disable-checker-imaging 启动参数已在 run.sh 钉死重采样路径，多模态理论上已被根治，
    #   众数制是它的纵深防御——两层独立机制，任一失效另一层兜底。）
    classes = []   # [ [代表帧 png_b64, 票数], ... ]
    for attempt in range(1, max_load_attempts + 1):
        png = _load_and_capture(cdp, base, state, vp_name, size, work_path)
        for cls in classes:
            if lsb_equivalent(png, cls[0]):
                cls[1] += 1
                break
        else:
            classes.append([png, 1])
        best = max(classes, key=lambda c: c[1])
        if best[1] >= majority_of:
            break
        if attempt >= 2:
            print(f'  … {label}: {attempt} 次加载分成 {len(classes)} 个等价类（最高 {best[1]} 票），继续重载取众数', flush=True)
    best = max(classes, key=lambda c: c[1])
    if best[1] < majority_of:
        raise RuntimeError(f'{label}: {max_load_attempts} 次独立加载没有任何等价类攒到 '
                            f'{majority_of} 票（当前分布 {[c[1] for c in classes]}），不敢采信')
    out = os.path.join(out_dir, f'{label}.png')
    with open(out, 'wb') as f: f.write(base64.b64decode(best[0]))
    print('  ✓', os.path.basename(out), flush=True)

def resolve_work_path(cdp, base):
    """借浏览器（在验证网络内）问 API：第一部有 work 的 session/plan → /work/<id>。
       注意：/api/sessions 返回 {sessions:[...]}，/api/plan 返回 {items:[...]}，都是带壳对象，不是裸数组。"""
    tid, sid = new_page(cdp, base, 800, 600, False)
    try:
        cdp.call('Page.navigate', {'url': base + '/'}, session=sid)
        serialize_image_loads(cdp, sid, base)
        settle(cdp, sid, timeout=10)
        wid = evaljs(cdp, sid,
            "fetch('/api/sessions',{credentials:'include'}).then(r=>r.json())"
            ".then(a=>(a&&a.sessions&&a.sessions[0]&&a.sessions[0].work_id)||fetch('/api/plan',{credentials:'include'})"
            ".then(r=>r.json()).then(b=>(b&&b.items&&b.items[0]&&b.items[0].work_id)||null))")
        if not wid:
            raise PageLogicError('数据副本里找不到任何 work，无法截 /work/:id')
        return f'/work/{wid}'
    finally:
        try:
            cdp.call('Target.closeTarget', {'targetId': tid})
        except Exception:
            pass

def warm_up(cdp, base, hshell_container):
    """开局白打一张一次性截图（不落盘）。目的：如果 GPU 命令缓冲区要崩那一下，让它崩在这张废片上，
       而不是崩在正式的 14 张之一——headless-shell 首次 captureScreenshot 有小概率触发的崩溃
       （见 shoot_with_retry 的说明）跟「暖机」次数无关，纯粹是运气，但先在这里买一次彩票，
       正式流程撞上的概率就低一些。真撞上了：跟正式流程一个待遇——重启浏览器容器再继续，
       不能让这只崩溃 renderer 卡成僵尸进程，拖累后面 14 张正式截图。"""
    try:
        tid, sid = new_page(cdp, base, 1280, 900, False)
        try:
            cdp.call('Page.navigate', {'url': base + '/'}, session=sid)
            serialize_image_loads(cdp, sid, base)
            settle(cdp, sid, timeout=10)
            cdp.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        finally:
            try:
                cdp.call('Target.closeTarget', {'targetId': tid})
            except Exception:
                pass
        print('warm-up ok', flush=True)
    except Exception as e:
        print(f'warm-up 撞上崩溃（{e}）——重启浏览器容器，保证正式流程从干净状态开始', flush=True)
        restart_browser(hshell_container)
        cdp.reconnect()

def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    cfg = json.load(open(os.path.join(HERE, 'pages.json')))
    cdp = CDP(args.cdp)
    warm_up(cdp, args.base, args.hshell_container)
    work_path = resolve_work_path(cdp, args.base)
    print('work page:', work_path, flush=True)
    for state in cfg['states']:
        for vp in state['viewports']:
            shoot_with_retry(cdp, args.base, args.out, state, vp, cfg['viewports'][vp], work_path, args.hshell_container)
    print('done →', args.out, flush=True)

if __name__ == '__main__':
    main()
