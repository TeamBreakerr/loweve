// 麦克风录音：MediaRecorder + 实时音量 + 屏幕常亮 + 分片写 IndexedDB 防丢。
// 录到一半页面被关/崩溃，已录部分留在本机，回到点评室可以继续上传（见 recordingCache）。
import { ref, onBeforeUnmount } from 'vue';
import { pickRecorderMime } from '../utils/reviewRoom';
import { appendChunk, clearPending, saveMeta } from '../utils/recordingCache';

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping';
// unsupported：浏览器不支持 / 非 HTTPS；denied：麦克风权限被拒；no_device：没有麦克风；
// interrupted：录着录着被系统打断（来电、拔耳机、iOS 切后台），已录部分在本机待上传
export type RecorderError = '' | 'unsupported' | 'denied' | 'no_device' | 'failed' | 'interrupted';
export interface RecordingResult { blob: Blob; durationMs: number; mime: string; key: string }

const TIMESLICE_MS = 5000;

export function isRecordingSupported() {
  return typeof window !== 'undefined' && window.isSecureContext !== false
    && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function useRecorder(cacheKey: () => string) {
  const state = ref<RecorderState>('idle');
  const elapsedMs = ref(0);
  const level = ref(0);        // 0–1，平滑过的输入音量
  const error = ref<RecorderError>('');

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mime = '';
  let seq = 0;
  let key = '';
  let startedAt = 0;
  let accumulated = 0;         // 已结束片段的累计时长（暂停不计）
  let segmentStart = 0;
  let tick: ReturnType<typeof setInterval> | null = null;
  let raf = 0;
  let audioCtx: AudioContext | null = null;
  let wakeLock: any = null;
  let stopResolve: ((r: RecordingResult) => void) | null = null;

  const currentElapsed = () => accumulated + (state.value === 'recording' ? performance.now() - segmentStart : 0);

  async function lockScreen() {
    try { wakeLock = await (navigator as any).wakeLock?.request('screen'); } catch { wakeLock = null; }
  }
  // 切到后台再回来，常亮锁会被系统收回，要重新申请
  function onVisibility() {
    if (document.visibilityState === 'visible' && (state.value === 'recording' || state.value === 'paused')) lockScreen();
  }
  function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ''; }

  function startMeter(s: MediaStream) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const target = state.value === 'recording' ? Math.min(1, Math.sqrt(sum / buf.length) * 4) : 0;
        level.value = level.value * 0.7 + target * 0.3;
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* 没有电平表也能录 */ }
  }

  function teardown() {
    if (tick) clearInterval(tick);
    tick = null;
    cancelAnimationFrame(raf);
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    wakeLock?.release?.().catch?.(() => {});
    wakeLock = null;
    recorder = null;
    level.value = 0;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function finish() {
    const durationMs = Math.round(accumulated);
    const type = chunks[0]?.type || mime;
    const result: RecordingResult = { blob: new Blob(chunks, { type }), durationMs, mime: type, key };
    saveMeta({ key, mime: type, startedAt, elapsedMs: durationMs });
    teardown();
    state.value = 'idle';
    elapsedMs.value = 0;
    if (stopResolve) { stopResolve(result); stopResolve = null; }
    else error.value = 'interrupted';   // 不是用户点的结束：系统打断了录音
  }

  async function start() {
    if (state.value !== 'idle') return;
    error.value = '';
    if (!isRecordingSupported()) { error.value = 'unsupported'; return; }
    state.value = 'requesting';
    try {
      // 两人对着一台设备聊：开自动增益让离得远的那位也录得清
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      state.value = 'idle';
      error.value = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied'
        : e?.name === 'NotFoundError' ? 'no_device' : 'failed';
      return;
    }
    mime = pickRecorderMime(t => MediaRecorder.isTypeSupported(t));
    try {
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000 });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    mime = recorder.mimeType || mime || 'audio/webm';
    chunks = []; seq = 0; accumulated = 0; elapsedMs.value = 0;
    key = cacheKey(); startedAt = Date.now();
    await clearPending(key);   // 同一场次的旧残片（已决定放弃的）不能混进新录音
    saveMeta({ key, mime, startedAt, elapsedMs: 0 });
    recorder.ondataavailable = (ev) => {
      if (!ev.data?.size) return;
      chunks.push(ev.data);
      appendChunk(key, seq++, ev.data);
      saveMeta({ key, mime: ev.data.type || mime, startedAt, elapsedMs: Math.round(currentElapsed()) });
    };
    recorder.onstop = finish;
    recorder.start(TIMESLICE_MS);
    segmentStart = performance.now();
    state.value = 'recording';
    tick = setInterval(() => { elapsedMs.value = currentElapsed(); }, 250);
    startMeter(stream);
    lockScreen();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  function pause() {
    if (state.value !== 'recording' || !recorder) return;
    recorder.pause();
    accumulated += performance.now() - segmentStart;
    state.value = 'paused';
    elapsedMs.value = accumulated;
  }

  function resume() {
    if (state.value !== 'paused' || !recorder) return;
    recorder.resume();
    segmentStart = performance.now();
    state.value = 'recording';
  }

  // 结束录音，拿到完整文件；本机缓存保留到上传成功后由调用方清掉
  function stop(): Promise<RecordingResult | null> {
    if (!recorder || (state.value !== 'recording' && state.value !== 'paused')) return Promise.resolve(null);
    if (state.value === 'recording') accumulated += performance.now() - segmentStart;
    state.value = 'stopping';
    return new Promise(resolve => { stopResolve = resolve; recorder!.stop(); });
  }

  async function discard() {
    const r = await stop();
    if (r) await clearPending(r.key);
  }

  // 录音中离开页面：停掉录音（最后一片照常写进本机缓存），回来能继续上传
  onBeforeUnmount(() => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => teardown();
      recorder.stop();
    } else teardown();
  });

  return { state, elapsedMs, level, error, start, pause, resume, stop, discard };
}
