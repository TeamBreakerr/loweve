<script setup lang="ts">
// 点评室：「一起看过」写点评的主入口。
// 两人看完边聊边录 → 上传 → asr-app 转写并分出说话人 → LLM 整理成两人各自的点评 + 讨论纪要 → 填进下面两栏。
// 这里既是 AI 写点评的地方，也是手改的地方：两栏、纪要、看完日期一改就自动保存（不录音也能直接写）。
// 原始录音永久保留，可回放、下载、看转写；采用 AI 草稿前的点评服务端留一份，随时能恢复。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, withViewing } from '../api/index';
import { listRecordings, regenerateRecording, retryRecording, uploadRecording } from '../api/recordings';
import { useSessions } from '../stores/sessions';
import { useIdentity } from '../stores/identity';
import { confirm } from '../composables/useConfirm';
import { isRecordingSupported, useRecorder } from '../composables/useRecorder';
import { clearPending, loadPending, type PendingMeta } from '../utils/recordingCache';
import {
  fmtBytes, fmtClock, formFromSession, formsEqual, isProcessing, mergeDraftIntoForm, speakersOf, stageIndex, swapSides,
  type JointForm,
} from '../utils/reviewRoom';
import { vAutoGrow } from '../directives/autoGrow';
import Poster from '../components/Poster.vue';
import ScorePicker from '../components/ScorePicker.vue';
import DatePicker from '../components/DatePicker.vue';
import type { ReviewRecording, SpeakerMap } from '../types';

const route = useRoute();
const router = useRouter();
const sessions = useSessions();
const identity = useIdentity();

const sessionId = computed(() => Number(route.params.id));
const session = computed(() => sessions.list.find(s => s.id === sessionId.value) || null);
const work = computed(() => session.value?.work || null);
const loading = ref(true);
const nameA = computed(() => identity.userById(1)?.display_name || 'A');
const nameB = computed(() => identity.userById(2)?.display_name || 'B');

// 服务端配置：没配转写时录音照样保存，只是不会自动生成
const asrReady = ref(true);
const llmReady = ref(true);
const recordingSupported = isRecordingSupported();

// ============================================================ 两人点评表单（自动保存）
const AUTOSAVE_MS = 1000;
const saved = ref<JointForm>(formFromSession(null));   // 服务端现在的值（最近一次保存成功的）
const form = ref<JointForm>(formFromSession(null));
const savedDate = ref<number | null>(null);
const watchedAt = ref<number | null>(null);
const draftFrom = ref<number | null>(null);            // 表单里现在用的是哪段录音的 AI 草稿
const beforeDraft = ref<JointForm | null>(null);       // 填草稿前的样子，「恢复填入前的」用
const saveState = ref<'saved' | 'pending' | 'saving' | 'error'>('saved');
const saveError = ref('');
const lastSavedAt = ref<number | null>(null);
const dirty = computed(() => !formsEqual(form.value, saved.value) || watchedAt.value !== savedDate.value);
const clone = (f: JointForm): JointForm => JSON.parse(JSON.stringify(f));

// 只在第一次拿到这条记录时从服务端填表单；之后以页面为准——保存回来的值（服务端去掉了首尾空白）
// 要是再写回表单，会把正在打的换行、空格冲掉。
let loadedFor: number | null = null;
watch(session, (s) => {
  if (!s || loadedFor === s.id) return;
  loadedFor = s.id;
  form.value = formFromSession(s);
  saved.value = formFromSession(s);
  watchedAt.value = savedDate.value = s.watched_at ?? null;
}, { immediate: true });

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<boolean> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; flushSave(); }, AUTOSAVE_MS);
}
// 停手 1 秒自动存；同一时刻只有一个保存在跑，跑的途中又改了就等它完再存一次
watch([form, watchedAt], () => {
  if (dirty.value) { saveState.value = 'pending'; scheduleSave(); }
  else if (saveState.value === 'pending') { saveState.value = 'saved'; if (saveTimer) clearTimeout(saveTimer); saveTimer = null; }
}, { deep: true });

function flushSave(): Promise<boolean> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!running) {
    running = doSave().finally(() => {
      running = null;
      if (dirty.value && saveState.value !== 'error') scheduleSave();
    });
  }
  return running;
}

async function doSave() {
  if (!dirty.value || !session.value) {
    if (saveState.value !== 'error') saveState.value = 'saved';
    return true;
  }
  const snapshot = clone(form.value);
  const date = watchedAt.value;
  const recordingId = draftFrom.value;
  saveState.value = 'saving'; saveError.value = '';
  try {
    if (date !== savedDate.value) {
      await sessions.update(sessionId.value, { watched_at: date });
      savedDate.value = date;
    }
    await sessions.jointReview(sessionId.value, { ...snapshot, recording_id: recordingId ?? undefined });
    saved.value = snapshot;
    lastSavedAt.value = Date.now();
    if (recordingId != null) onDraftApplied(recordingId);
    saveState.value = dirty.value ? 'pending' : 'saved';
    return true;
  } catch (e) {
    saveState.value = 'error';
    saveError.value = e.body?.error === 'invalid_rating' ? '评分要在 1–10 之间' : (e.body?.error || e.message || '网络问题');
    return false;
  }
}

// 关页面 / 刷新时还有没存的：用 keepalive 请求把最后的改动送出去（页面卸载后请求也会发完）
function saveOnExit() {
  if (!dirty.value || !session.value) return;
  const send = (url: string, body: any) => fetch(withViewing(url), {
    method: 'PUT', keepalive: true, credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => {});
  if (watchedAt.value !== savedDate.value) send(`/api/sessions/${sessionId.value}`, { watched_at: watchedAt.value });
  send(`/api/sessions/${sessionId.value}/joint-review`, { ...form.value, recording_id: draftFrom.value ?? undefined });
}
// 手机切到别的 App：马上存，不等计时
function onVisibility() { if (document.visibilityState === 'hidden' && dirty.value) flushSave(); }

const saveLabel = computed(() => ({
  saving: '保存中…',
  pending: '有改动，马上自动保存…',
  error: `没保存上：${saveError.value}`,
  saved: lastSavedAt.value ? `已自动保存 · ${fmtTime(lastSavedAt.value)}` : '改动会自动保存',
}[saveState.value]));
function fmtTime(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sideChanged(side: 'a' | 'b') {
  const b = beforeDraft.value?.[side];
  return !!b && (b.comment.trim() !== form.value[side].comment.trim() || b.rating !== form.value[side].rating);
}
function restoreSide(side: 'a' | 'b') {
  if (beforeDraft.value) form.value = { ...form.value, [side]: { ...beforeDraft.value[side] } };
}
function swap() { form.value = swapSides(form.value); }

// ============================================================ 录音存档与处理进度
const recordings = ref<ReviewRecording[]>([]);
const latest = computed(() => recordings.value[0] || null);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshRecordings() {
  const before = new Map(recordings.value.map(r => [r.id, r.status]));
  recordings.value = await listRecordings(sessionId.value);
  for (const r of recordings.value) {
    const was = before.get(r.id);
    if (was && isProcessing(was) && r.status === 'ready') onDraftReady(r);   // 就在这页等出来的：直接填
  }
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!recordings.value.some(r => isProcessing(r.status))) return;
  pollTimer = setTimeout(async () => {
    try { await refreshRecordings(); } catch { /* 下一轮再试 */ }
    schedulePoll();
  }, 4000);
}

// AI 草稿：在页面上等出来的自动填进两栏（两人没在改的话）；回来才看到的给个提示，让他们自己决定
const draftNotice = ref<ReviewRecording | null>(null);
const DISMISS_KEY = 'loweve.reviewRoom.dismissedDrafts';
function dismissedIds(): number[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; }
}
function dismissDraft(r: ReviewRecording) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissedIds(), r.id].slice(-50))); } catch { /* 只影响提示 */ }
  draftNotice.value = null;
}
// 填入草稿就会自动保存；填之前的样子留在页面上可以逐栏恢复，服务端也会留一份（见 restoreReplaced）
function useDraft(r: ReviewRecording) {
  if (!r.draft) return;
  if (draftFrom.value == null) beforeDraft.value = clone(form.value);
  form.value = mergeDraftIntoForm(form.value, r.draft);
  draftFrom.value = r.id;
  draftNotice.value = null;
}
function onDraftReady(r: ReviewRecording) {
  if (!r.draft) return;
  if (!dirty.value) useDraft(r);
  else draftNotice.value = r;
}
function onDraftApplied(id: number) {
  const r = recordings.value.find(x => x.id === id);
  if (!r) return;
  r.applied_at = Date.now();
  if (!r.replaced) listRecordings(sessionId.value).then(list => { recordings.value = list; }).catch(() => {});   // 拿回服务端留的「采用前」副本
}
// 恢复成第一次采用这段草稿之前的点评（服务端留的副本，换设备、刷新后也在）
async function restoreReplaced(r: ReviewRecording) {
  if (!r.replaced) return;
  if (!await confirm({ title: '恢复成采用这段之前的点评？', message: '两栏和讨论纪要会换回采用 AI 草稿前的样子，并自动保存。', confirmLabel: '恢复' })) return;
  form.value = {
    a: { rating: r.replaced.a.rating, comment: r.replaced.a.comment || '' },
    b: { rating: r.replaced.b.rating, comment: r.replaced.b.comment || '' },
    joint_note: r.replaced.joint_note || '',
  };
  draftFrom.value = null;
  beforeDraft.value = null;
}

// ============================================================ 录音
const recorder = useRecorder(() => `session-${sessionId.value}`);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref('');
const pending = ref<{ meta: PendingMeta; blob: Blob } | null>(null);
const tooShort = ref(false);

const RECORDER_ERRORS: Record<string, string> = {
  unsupported: '这个浏览器不能录音（需要 HTTPS 和较新的浏览器）。',
  denied: '麦克风权限被拒绝了。在浏览器地址栏左边的网站设置里允许麦克风，再点一次开始。',
  no_device: '没找到麦克风。',
  failed: '打不开麦克风，可能被别的应用占用了。',
  interrupted: '录音被系统打断了（来电、切后台等）。已经录下的部分保存在这台设备上，可以直接上传。',
};
const UPLOAD_ERRORS: Record<string, string> = {
  upload_network: '网络断了，录音还保存在这台设备上，可以重新上传。',
  recording_too_large: '录音太大了（上限 500 MB）。',
  unsupported_audio_type: '服务器不认这个录音格式。',
  empty_recording: '录音是空的。',
};

async function startRecording() {
  tooShort.value = false; uploadError.value = '';
  if (pending.value && !await confirm({
    title: '上一段录音还没上传', message: '开始新的录音会丢掉这台设备上那段没上传的录音。', confirmLabel: '丢掉，重新录', danger: true,
  })) return;
  pending.value = null;
  await recorder.start();
}

async function finishRecording() {
  const r = await recorder.stop();
  if (!r) return;
  if (r.durationMs < 2000 || !r.blob.size) {
    tooShort.value = true;
    await clearPending(r.key);
    return;
  }
  await upload(r.blob, r.durationMs, r.key);
}

async function discardRecording() {
  if (!await confirm({ title: '放弃这段录音？', message: '刚录的内容不会上传，也不会保留。', confirmLabel: '放弃', danger: true })) return;
  await recorder.discard();
}

async function upload(blob: Blob, durationMs: number, key: string) {
  uploading.value = true; uploadProgress.value = 0; uploadError.value = '';
  try {
    const created = await uploadRecording(sessionId.value, blob, durationMs, p => { uploadProgress.value = p; });
    await clearPending(key);
    pending.value = null;
    recordings.value = [created, ...recordings.value.filter(x => x.id !== created.id)];
    schedulePoll();
  } catch (e) {
    const code = e.body?.error || e.message;
    uploadError.value = UPLOAD_ERRORS[code] || `上传失败（${code}），录音还保存在这台设备上，可以重新上传。`;
    pending.value = { meta: { key, mime: blob.type, startedAt: Date.now(), elapsedMs: durationMs }, blob };
  } finally {
    uploading.value = false;
  }
}

async function uploadPending() {
  if (pending.value) await upload(pending.value.blob, pending.value.meta.elapsedMs, pending.value.meta.key);
}
async function dropPending() {
  if (!pending.value) return;
  if (!await confirm({ title: '丢掉这段录音？', message: '它只保存在这台设备上，丢掉就找不回来了。', confirmLabel: '丢掉', danger: true })) return;
  await clearPending(pending.value.meta.key);
  pending.value = null;
}

watch(() => recorder.error.value, async (err) => {
  if (err === 'interrupted') pending.value = await loadPending(`session-${sessionId.value}`);
});

// 录音台当前阶段
const phase = computed(() => {
  const st = recorder.state.value;
  if (st !== 'idle') return st === 'paused' ? 'paused' : 'recording';
  if (uploading.value) return 'uploading';
  if (latest.value && isProcessing(latest.value.status)) return 'processing';
  return 'idle';
});
const STEPS = ['上传录音', '转写对话', '生成点评'];
const stepAt = computed(() => phase.value === 'uploading' ? 0 : latest.value ? stageIndex(latest.value.status) : 0);
const haloScale = computed(() => 1 + recorder.level.value * 0.55);

async function retry(r: ReviewRecording) {
  const updated = await retryRecording(r.id);
  replaceRecording(updated);
  schedulePoll();
}

function replaceRecording(r: ReviewRecording) {
  recordings.value = recordings.value.map(x => x.id === r.id ? r : x);
}

// ============================================================ 存档：转写里的说话人 ↔ 人
function mapOf(r: ReviewRecording): SpeakerMap {
  return r.draft?.speaker_map || r.speaker_map || {};
}
function speakerWho(r: ReviewRecording, label: string) {
  const v = mapOf(r)[label];
  return v === 1 ? 'a' : v === 2 ? 'b' : v === null ? 'none' : '';
}
function speakerName(r: ReviewRecording, label: string) {
  const v = mapOf(r)[label];
  return v === 1 ? nameA.value : v === 2 ? nameB.value : v === null ? '其他声音' : `说话人${label}`;
}

const mapEditing = ref<number | null>(null);
const mapDraft = ref<Record<string, string>>({});
function editMap(r: ReviewRecording) {
  mapEditing.value = r.id;
  mapDraft.value = Object.fromEntries(speakersOf(r.transcript).map(s => {
    const v = mapOf(r)[s];
    return [s, v === 1 ? '1' : v === 2 ? '2' : 'none'];
  }));
}
const mapValid = computed(() => Object.values(mapDraft.value).some(v => v !== 'none'));
async function regenerate(r: ReviewRecording) {
  const map = Object.fromEntries(Object.entries(mapDraft.value).map(([k, v]) => [k, v === 'none' ? null : Number(v)])) as SpeakerMap;
  const updated = await regenerateRecording(r.id, map);
  replaceRecording(updated);
  mapEditing.value = null;
  schedulePoll();
}

// MediaRecorder 录的 webm 不带总时长（Chrome 的老问题），播放器拿到 Infinity：显示 0:00、进度条拖不动。
// 先跳到极远处逼浏览器读到文件尾算出真实时长，再跳回开头。
function fixInfiniteDuration(e: Event) {
  const a = e.target as HTMLAudioElement;
  if (Number.isFinite(a.duration)) return;
  const back = () => {
    if (!Number.isFinite(a.duration)) return;
    a.removeEventListener('durationchange', back);
    a.currentTime = 0;
  };
  a.addEventListener('durationchange', back);
  a.currentTime = 1e101;
}

function fmtDateTime(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function statusLabel(r: ReviewRecording) {
  return { uploaded: '排队中', transcribing: '转写中', summarizing: '生成中', ready: r.applied_at ? '已采用' : '草稿未采用', error: '失败' }[r.status];
}

// ============================================================ 删除整条共看记录
async function removeSession() {
  if (!await confirm({ title: '移入回收站？', message: '之后可在「设置 → 回收站」恢复；讨论录音会保留。', confirmLabel: '移入回收站' })) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  await sessions.remove(sessionId.value);
  form.value = saved.value; watchedAt.value = savedDate.value;   // 记录已删，不再自动保存
  router.push('/together');
}

onBeforeRouteLeave(async () => {
  if (recorder.state.value === 'recording' || recorder.state.value === 'paused') {
    return confirm({
      title: '还在录音', message: '离开会停止录音。已录的部分保存在这台设备上，回到这里可以继续上传。', confirmLabel: '停止并离开',
    });
  }
  // 离开前把没存的改动存掉；存不上才问
  let ok = true;
  for (let i = 0; i < 3 && ok && (dirty.value || running); i++) ok = await flushSave();
  if (!ok) {
    return confirm({ title: '点评没保存上', message: `${saveError.value}。离开的话这次的修改会丢失。`, confirmLabel: '仍然离开', danger: true });
  }
  return true;
});

onMounted(async () => {
  window.addEventListener('pagehide', saveOnExit);
  document.addEventListener('visibilitychange', onVisibility);
  try {
    if (!session.value) await sessions.load();   // 直接打开链接 / 刚添加完跳过来，列表里可能还没有
    if (!session.value) return;
    const [, settings] = await Promise.all([refreshRecordings(), api('/api/settings').catch(() => null)]);
    if (settings) { asrReady.value = !!settings.asr_ready; llmReady.value = !!settings.llm_ready; }
    pending.value = await loadPending(`session-${sessionId.value}`);
    const r = latest.value;
    if (r?.status === 'ready' && r.draft && !r.applied_at && !dismissedIds().includes(r.id)) draftNotice.value = r;
    schedulePoll();
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
  if (saveTimer) clearTimeout(saveTimer);
  window.removeEventListener('pagehide', saveOnExit);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <main class="page rr">
    <router-link class="back-link" to="/together">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回一起看过
    </router-link>

    <p v-if="loading" class="rr-state">加载中…</p>
    <p v-else-if="!session" class="rr-state">找不到这条一起看过的记录，可能已经移入回收站。</p>

    <template v-else>
      <!-- 片头：作品 + 看完日期 -->
      <header class="rr-head">
        <Poster v-if="work" :color="'#2a2a30'" :url="work.primary_poster_url" :kind="work.is_anime ? '番剧' : ''" class="rr-head__poster"
                @click="router.push(`/work/${session.work_id}`)" />
        <div class="rr-head__text">
          <span class="page-hero__kicker">After the Credits · 一起点评</span>
          <h1 class="rr-head__title">{{ work?.title }} <span v-if="work?.year" class="rr-head__year">{{ work.year }}</span></h1>
          <div class="rr-head__date">
            <span class="rr-head__date-label">看完日期</span>
            <DatePicker v-model="watchedAt" class="rr-head__date-input" />
          </div>
        </div>
      </header>

      <!-- 录音台 -->
      <section class="rr-booth" :class="`is-${phase}`">
        <div class="rr-booth__stage">
          <div class="rr-mic">
            <span class="rr-mic__halo" :style="{ transform: `scale(${haloScale})` }"></span>
            <button v-if="phase === 'idle'" class="rr-mic__btn" :disabled="!recordingSupported || recorder.state.value === 'requesting'"
                    aria-label="开始录音" @click="startRecording">
              <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"/></svg>
            </button>
            <button v-else-if="phase === 'recording'" class="rr-mic__btn rr-mic__btn--live" aria-label="暂停" @click="recorder.pause">
              <svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>
            </button>
            <button v-else-if="phase === 'paused'" class="rr-mic__btn rr-mic__btn--paused" aria-label="继续录音" @click="recorder.resume">
              <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>
            </button>
            <div v-else class="rr-mic__btn rr-mic__btn--busy" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 12h2l2-6 3 12 3-9 2 3h4"/></svg>
            </div>
          </div>

          <div class="rr-booth__body">
            <!-- 待录 -->
            <template v-if="phase === 'idle'">
              <h2 class="rr-booth__title">边聊边录，自动写好两个人的点评</h2>
              <p class="rr-booth__lead">把手机放在你们俩中间，像平时一样聊就行。结束后会自动转写、分出谁说了什么，整理成 {{ nameA }} 和 {{ nameB }} 各自的点评和一份讨论纪要；原始录音一直保留。</p>
              <p v-if="!recordingSupported" class="rr-note rr-note--warn">{{ RECORDER_ERRORS.unsupported }}</p>
              <p v-else-if="!asrReady" class="rr-note rr-note--warn">还没配置语音转写服务：录音会保存，但不会自动生成点评（设置页「语音转写服务地址」）。</p>
              <p v-else-if="!llmReady" class="rr-note rr-note--warn">还没配置 LLM：会转写，但不会生成点评（设置页「AI 推荐」）。</p>
              <p v-if="recorder.error.value && recorder.error.value !== 'interrupted'" class="rr-note rr-note--error">{{ RECORDER_ERRORS[recorder.error.value] }}</p>
              <p v-if="tooShort" class="rr-note">录音太短了，没有上传。</p>
              <p v-if="latest?.status === 'error'" class="rr-note rr-note--error">
                上一段录音没处理完：{{ latest.stage_message }}
                <button class="rr-link" @click="retry(latest)">重试</button>
              </p>
              <div class="rr-booth__actions">
                <button class="btn btn--rose rr-start" :disabled="!recordingSupported || recorder.state.value === 'requesting'" @click="startRecording">
                  {{ recorder.state.value === 'requesting' ? '等待麦克风权限…' : (recordings.length ? '再录一段' : '开始录讨论') }}
                </button>
              </div>
            </template>

            <!-- 录音中 / 暂停 -->
            <template v-else-if="phase === 'recording' || phase === 'paused'">
              <div class="rr-timer" :class="{ 'is-paused': phase === 'paused' }">
                <span class="rr-timer__dot"></span>{{ fmtClock(recorder.elapsedMs.value / 1000) }}
                <span class="rr-timer__state">{{ phase === 'paused' ? '已暂停' : '录音中' }}</span>
              </div>
              <p class="rr-booth__lead">聊完点「结束」。中途要接电话可以先暂停；屏幕会保持常亮。</p>
              <div class="rr-booth__actions">
                <button class="btn btn--rose" :disabled="recorder.state.value === 'stopping'" @click="finishRecording">结束，生成点评</button>
                <button class="btn btn--ghost" @click="phase === 'paused' ? recorder.resume() : recorder.pause()">{{ phase === 'paused' ? '继续' : '暂停' }}</button>
                <button class="btn rr-discard" @click="discardRecording">放弃</button>
              </div>
            </template>

            <!-- 上传 / 处理中 -->
            <template v-else>
              <ol class="rr-steps">
                <li v-for="(label, i) in STEPS" :key="label" class="rr-steps__item"
                    :class="{ 'is-done': i < stepAt, 'is-now': i === stepAt }">
                  <span class="rr-steps__dot">{{ i < stepAt ? '✓' : i + 1 }}</span>{{ label }}
                </li>
              </ol>
              <div v-if="phase === 'uploading'" class="rr-progress"><span :style="{ width: `${Math.round(uploadProgress * 100)}%` }"></span></div>
              <p class="rr-booth__lead">
                {{ phase === 'uploading' ? `上传中 ${Math.round(uploadProgress * 100)}%` : (latest?.stage_message || '处理中…') }}
                <template v-if="phase === 'processing'">转写长讨论要几分钟，可以先去别处逛逛，生成好了会在这里等你。</template>
              </p>
            </template>
          </div>
        </div>

        <!-- 本机还有没上传的录音 -->
        <div v-if="pending && phase === 'idle'" class="rr-pending">
          <span>这台设备上有一段 {{ fmtClock(pending.meta.elapsedMs / 1000) }} 的录音还没上传。</span>
          <button class="btn btn--rose" :disabled="uploading" @click="uploadPending">上传</button>
          <button class="btn btn--ghost" @click="dropPending">丢掉</button>
        </div>
        <p v-if="uploadError" class="rr-note rr-note--error rr-booth__foot">{{ uploadError }}</p>
      </section>

      <!-- 两人点评 -->
      <section class="rr-reviews">
        <div class="section__head">
          <h2 class="section__title">两个人的点评</h2>
          <span v-if="draftFrom != null" class="rr-ai-tag">AI 草稿 · 已自动保存，直接改就行</span>
          <div class="section__actions">
            <span class="rr-save-state" :class="`is-${saveState}`">{{ saveLabel }}</span>
            <button class="btn btn--ghost rr-swap" data-tip="说话人认反了？两栏对调" @click="swap">
              <svg class="btn__ic" viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>对调
            </button>
          </div>
        </div>

        <div v-if="draftNotice" class="rr-draft-notice">
          <span>{{ fmtDateTime(draftNotice.created_at) }} 那段录音的 AI 点评草稿已经生成好了。</span>
          <button class="btn btn--rose" @click="useDraft(draftNotice)">填进来（会自动保存，可恢复）</button>
          <button class="btn btn--ghost" @click="dismissDraft(draftNotice)">先不用</button>
        </div>

        <div class="rr-sides">
          <div v-for="side in (['a', 'b'] as const)" :key="side" class="rr-side" :data-who="side">
            <div class="rr-side__head">
              <span class="rr-side__avatar">{{ (side === 'a' ? nameA : nameB)[0] }}</span>
              <span class="rr-side__name">{{ side === 'a' ? nameA : nameB }}</span>
              <button v-if="draftFrom != null && sideChanged(side)"
                      class="rr-link rr-side__restore" @click="restoreSide(side)">恢复填入前的</button>
            </div>
            <ScorePicker v-model="form[side].rating" label="评分" />
            <textarea v-model="form[side].comment" v-auto-grow class="review-input rr-side__text"
                      :placeholder="`${side === 'a' ? nameA : nameB} 的点评…`"></textarea>
          </div>
        </div>

        <div class="field rr-joint">
          <span class="field__label">讨论纪要</span>
          <textarea v-model="form.joint_note" v-auto-grow class="review-input" placeholder="这次聊了什么、哪里有分歧、哪里有共识…"></textarea>
        </div>

        <div class="rr-save">
          <span class="rr-save-state" :class="`is-${saveState}`">{{ saveLabel }}</span>
          <button v-if="saveState === 'error'" class="rr-link" @click="flushSave">重试</button>
        </div>
      </section>

      <!-- 讨论录音存档 -->
      <section v-if="recordings.length" class="rr-archive">
        <div class="section__head">
          <h2 class="section__title">讨论录音</h2>
          <span class="section__hint">原始录音一直保留</span>
        </div>
        <article v-for="r in recordings" :key="r.id" class="rr-tape" :class="`is-${r.status}`">
          <div class="rr-tape__meta">
            <strong>{{ fmtDateTime(r.created_at) }}</strong>
            <span v-if="r.duration_ms">{{ fmtClock(r.duration_ms / 1000) }}</span>
            <span>{{ fmtBytes(r.size_bytes) }}</span>
            <span class="rr-chip" :class="`rr-chip--${r.status}`">{{ statusLabel(r) }}</span>
            <a class="rr-link rr-tape__dl" :href="`${r.audio_url}?download=1`">下载</a>
          </div>
          <audio class="rr-tape__audio" :src="r.audio_url" controls preload="metadata" @loadedmetadata="fixInfiniteDuration"></audio>
          <p v-if="r.status === 'error'" class="rr-note rr-note--error">{{ r.stage_message }} <button class="rr-link" @click="retry(r)">重试</button></p>
          <p v-else-if="isProcessing(r.status)" class="rr-note">{{ r.stage_message || '处理中…' }}</p>

          <div v-if="r.status === 'ready' && r.draft" class="rr-tape__actions">
            <button class="btn btn--ghost" @click="useDraft(r)">把这段的草稿填进上面</button>
            <button v-if="r.transcript?.length" class="btn btn--ghost" @click="mapEditing === r.id ? (mapEditing = null) : editMap(r)">谁是谁不对？</button>
            <button v-if="r.replaced && r.applied_at" class="btn btn--ghost" @click="restoreReplaced(r)">恢复成采用这段之前的点评</button>
          </div>

          <div v-if="mapEditing === r.id" class="rr-map">
            <p class="rr-map__hint">按转写内容指定每个说话人是谁（同一个人被拆成两个标签时都选他），然后重新生成这段的草稿：</p>
            <label v-for="label in Object.keys(mapDraft)" :key="label" class="rr-map__row">
              <span>说话人{{ label }}</span>
              <select v-model="mapDraft[label]" class="input rr-map__select">
                <option value="1">{{ nameA }}</option>
                <option value="2">{{ nameB }}</option>
                <option value="none">其他声音（忽略）</option>
              </select>
            </label>
            <button class="btn btn--rose" :disabled="!mapValid" @click="regenerate(r)">按这个对应重新生成</button>
          </div>

          <details v-if="r.transcript?.length" class="rr-transcript">
            <summary>转写全文 · {{ r.transcript.length }} 段</summary>
            <p v-for="(t, i) in r.transcript" :key="i" class="rr-turn" :data-who="speakerWho(r, t.speaker)">
              <span class="rr-turn__ts">{{ fmtClock(t.start) }}</span>
              <span class="rr-turn__who">{{ speakerName(r, t.speaker) }}</span>
              <span class="rr-turn__text">{{ t.text }}</span>
            </p>
          </details>
        </article>
      </section>

      <footer class="rr-foot">
        <button class="btn btn--ghost rr-foot__del" @click="removeSession">把这条一起看过移入回收站</button>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.rr-state{ color:var(--text-faint); text-align:center; padding:var(--s-12) 0; }

/* 片头 */
.rr-head{ display:flex; gap:var(--s-5); align-items:flex-end; margin-bottom:var(--s-6); }
.rr-head__poster{ width:104px; flex-shrink:0; cursor:pointer; box-shadow:var(--shadow-poster); }
.rr-head__text{ min-width:0; display:flex; flex-direction:column; gap:6px; }
.rr-head__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-2xl); line-height:1.15; }
.rr-head__year{ font-family:var(--font-sans); font-weight:400; font-size:var(--fs-md); color:var(--text-faint); }
.rr-head__date{ display:flex; align-items:center; gap:var(--s-3); flex-wrap:wrap; color:var(--text-faint); font-size:var(--fs-sm); }
.rr-head__date-input{ max-width:180px; }

/* 录音台：放映厅里的一张暗色操作台，话筒键是主角 */
.rr-booth{
  position:relative; overflow:hidden;
  background:linear-gradient(135deg, var(--surface) 0%, oklch(0.2 0.02 30) 100%);
  border:1px solid var(--line); border-radius:var(--r-xl); box-shadow:var(--shadow-card);
  padding:var(--s-6); margin-bottom:var(--s-10);
}
.rr-booth::before{   /* 胶片齿孔装饰 */
  content:""; position:absolute; left:0; right:0; top:0; height:10px; opacity:.5;
  background-image:radial-gradient(circle, var(--line) 0 2px, transparent 2.6px); background-size:16px 10px;
}
.rr-booth__stage{ display:flex; gap:var(--s-6); align-items:center; }
.rr-booth__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--s-3); }
.rr-booth__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-lg); }
.rr-booth__lead{ color:var(--text-dim); line-height:1.7; font-size:var(--fs-sm); max-width:620px; }
.rr-booth__actions{ display:flex; gap:var(--s-2); flex-wrap:wrap; margin-top:var(--s-1); }
.rr-booth__foot{ margin-top:var(--s-3); }
.rr-start{ padding:11px 22px; }
.rr-discard{ color:var(--text-faint); }

.rr-mic{ position:relative; width:120px; height:120px; flex-shrink:0; display:grid; place-items:center; }
.rr-mic__halo{
  position:absolute; inset:6px; border-radius:50%; background:var(--rose-tint);
  box-shadow:0 0 0 1px var(--rose-line); transition:transform .08s linear;
}
.rr-booth.is-idle .rr-mic__halo{ animation:rr-breathe 3.2s ease-in-out infinite; }
@keyframes rr-breathe{ 0%,100%{ transform:scale(1); opacity:.7 } 50%{ transform:scale(1.08); opacity:1 } }
.rr-mic__btn{
  position:relative; width:84px; height:84px; border-radius:50%; display:grid; place-items:center;
  background:var(--rose); color:oklch(0.16 0.02 30); border:none;
  box-shadow:0 10px 30px -8px var(--rose-dim); transition:transform .15s var(--ease), background .2s;
}
.rr-mic__btn:hover:not(:disabled){ transform:scale(1.04); background:var(--rose-bright); }
.rr-mic__btn:disabled{ opacity:.45; cursor:not-allowed; }
.rr-mic__btn svg{ width:34px; height:34px; stroke:currentColor; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.rr-mic__btn--live{ background:oklch(0.62 0.2 25); color:#fff; }
.rr-mic__btn--paused{ background:var(--surface-3); color:var(--text); }
.rr-mic__btn--paused svg{ fill:currentColor; stroke:none; }
.rr-mic__btn--busy{ background:var(--surface-3); color:var(--rose); }
.rr-mic__btn--busy svg{ animation:rr-pulse 1.4s ease-in-out infinite; }
@keyframes rr-pulse{ 50%{ opacity:.35 } }

.rr-timer{ display:flex; align-items:center; gap:var(--s-3); font-family:var(--font-brand); font-size:44px; line-height:1; font-variant-numeric:tabular-nums; color:var(--text); }
.rr-timer__dot{ width:12px; height:12px; border-radius:50%; background:oklch(0.62 0.2 25); box-shadow:0 0 12px oklch(0.62 0.2 25); animation:rr-pulse 1.2s steps(2) infinite; }
.rr-timer.is-paused .rr-timer__dot{ background:var(--text-faint); box-shadow:none; animation:none; }
.rr-timer__state{ font-family:var(--font-sans); font-size:var(--fs-sm); color:var(--text-faint); }

.rr-steps{ display:flex; gap:var(--s-4); flex-wrap:wrap; list-style:none; padding:0; margin:0; }
.rr-steps__item{ display:flex; align-items:center; gap:8px; color:var(--text-faint); font-size:var(--fs-sm); }
.rr-steps__dot{ width:24px; height:24px; border-radius:50%; display:grid; place-items:center; border:1px solid var(--line); font-size:12px; }
.rr-steps__item.is-done{ color:var(--text-dim); }
.rr-steps__item.is-done .rr-steps__dot{ background:var(--rose-tint); border-color:var(--rose-line); color:var(--rose); }
.rr-steps__item.is-now{ color:var(--text); }
.rr-steps__item.is-now .rr-steps__dot{ border-color:var(--rose); color:var(--rose); animation:rr-pulse 1.4s ease-in-out infinite; }
.rr-progress{ height:4px; border-radius:var(--r-pill); background:var(--surface-3); overflow:hidden; }
.rr-progress span{ display:block; height:100%; background:var(--rose); transition:width .2s; }

.rr-pending, .rr-draft-notice{
  display:flex; align-items:center; gap:var(--s-2); flex-wrap:wrap; margin-top:var(--s-4);
  padding:var(--s-3) var(--s-4); border-radius:var(--r-md); background:var(--rose-tint); border:1px solid var(--rose-line);
  font-size:var(--fs-sm); color:var(--text);
}
.rr-pending span, .rr-draft-notice span{ flex:1; min-width:200px; }
.rr-draft-notice{ margin:0 0 var(--s-4); }

.rr-note{ font-size:var(--fs-sm); color:var(--text-faint); line-height:1.6; }
.rr-note--warn{ color:var(--gold); }
.rr-note--error{ color:var(--rose-bright); }
.rr-link{ color:var(--rose); text-decoration:underline; text-underline-offset:3px; font-size:inherit; background:none; border:none; padding:0; cursor:pointer; }

/* 两人点评 */
.rr-reviews{ margin-bottom:var(--s-12); }
.rr-ai-tag{ font-size:var(--fs-cap); color:var(--rose); border:1px solid var(--rose-line); background:var(--rose-tint); border-radius:var(--r-pill); padding:2px 9px; margin-bottom:3px; }
.rr-swap{ padding:7px 12px; }
.rr-sides{ display:grid; grid-template-columns:1fr 1fr; gap:var(--s-4); }
.rr-side{
  display:flex; flex-direction:column; gap:var(--s-3); padding:var(--s-4);
  background:var(--surface); border-radius:var(--r-lg); border:1px solid var(--line-soft); border-top:3px solid var(--who);
}
.rr-side[data-who="a"]{ --who:var(--user-a); }
.rr-side[data-who="b"]{ --who:var(--user-b); }
.rr-side__head{ display:flex; align-items:center; gap:var(--s-2); }
.rr-side__avatar{ width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:var(--who); color:var(--bg); font-size:12px; font-weight:700; }
.rr-side__name{ font-weight:600; }
.rr-side__restore{ margin-left:auto; font-size:var(--fs-sm); }
.rr-side__text{ min-height:120px; }
.rr-joint{ margin-top:var(--s-4); }
.rr-save{ display:flex; align-items:center; gap:var(--s-3); margin-top:var(--s-3); flex-wrap:wrap; font-size:var(--fs-sm); }
.rr-save-state{ font-size:var(--fs-sm); color:var(--text-faint); }
.rr-save-state.is-pending, .rr-save-state.is-saving{ color:var(--gold); }
.rr-save-state.is-error{ color:var(--rose-bright); }

/* 录音存档 */
.rr-archive{ margin-bottom:var(--s-10); display:flex; flex-direction:column; gap:var(--s-3); }
.rr-archive .section__head{ margin-bottom:var(--s-2); }
.rr-tape{ background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--r-lg); padding:var(--s-4); display:flex; flex-direction:column; gap:var(--s-3); }
.rr-tape__meta{ display:flex; align-items:center; gap:var(--s-3); flex-wrap:wrap; font-size:var(--fs-sm); color:var(--text-faint); }
.rr-tape__meta strong{ color:var(--text); font-weight:600; }
.rr-tape__dl{ margin-left:auto; font-size:var(--fs-sm); }
.rr-tape__audio{ width:100%; height:40px; }
.rr-tape__actions{ display:flex; gap:var(--s-2); flex-wrap:wrap; }
.rr-chip{ font-size:var(--fs-cap); padding:2px 8px; border-radius:var(--r-pill); border:1px solid var(--line); }
.rr-chip--ready{ color:var(--rose); border-color:var(--rose-line); background:var(--rose-tint); }
.rr-chip--error{ color:var(--rose-bright); border-color:var(--rose-line); }
.rr-chip--uploaded, .rr-chip--transcribing, .rr-chip--summarizing{ color:var(--gold); }

.rr-map{ display:flex; flex-direction:column; gap:var(--s-2); padding:var(--s-3); border-radius:var(--r-md); background:var(--surface-2); }
.rr-map__hint{ font-size:var(--fs-sm); color:var(--text-dim); line-height:1.6; }
.rr-map__row{ display:flex; align-items:center; gap:var(--s-3); font-size:var(--fs-sm); }
.rr-map__row > span{ width:64px; color:var(--text-dim); }
.rr-map__select{ flex:0 1 220px; min-width:0; padding:7px 10px; }
.rr-map .btn{ align-self:flex-start; }

.rr-transcript summary{ cursor:pointer; color:var(--text-dim); font-size:var(--fs-sm); }
.rr-transcript[open] summary{ margin-bottom:var(--s-2); }
.rr-turn{ display:grid; grid-template-columns:44px 72px 1fr; gap:var(--s-2); font-size:var(--fs-sm); line-height:1.65; padding:3px 0; }
.rr-turn__ts{ color:var(--text-faint); font-variant-numeric:tabular-nums; }
.rr-turn__who{ color:var(--text-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rr-turn[data-who="a"] .rr-turn__who{ color:var(--user-a); }
.rr-turn[data-who="b"] .rr-turn__who{ color:var(--user-b); }
.rr-turn[data-who="none"]{ opacity:.55; }
.rr-turn__text{ color:var(--text-dim); }

.rr-foot{ display:flex; justify-content:center; padding-top:var(--s-6); border-top:1px solid var(--line-soft); }
.rr-foot__del{ color:var(--rose-bright); border-color:var(--rose-line); }

@media (max-width:680px){
  .rr-head{ align-items:flex-start; }
  .rr-head__poster{ width:76px; }
  .rr-booth{ padding:var(--s-5) var(--s-4); }
  .rr-booth__stage{ flex-direction:column; align-items:stretch; text-align:left; }
  .rr-mic{ align-self:center; }
  .rr-timer{ font-size:36px; }
  .rr-sides{ grid-template-columns:1fr; }
  .rr-turn{ grid-template-columns:40px 1fr; }
  .rr-turn__text{ grid-column:1 / -1; }
}
@media (prefers-reduced-motion: reduce){
  .rr-booth.is-idle .rr-mic__halo, .rr-mic__btn--busy svg, .rr-timer__dot, .rr-steps__item.is-now .rr-steps__dot{ animation:none; }
}
</style>
