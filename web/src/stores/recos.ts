// web/src/stores/recos.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index';
import { usePlan } from './plan';
import { useMarks } from './marks';
import type { Reco } from '../types';

// 反馈按钮 emit → 后端 action
const ACTION = { want: 'want', no: 'not_interested', seen: 'already_seen' };

export const useRecos = defineStore('recos', () => {
  const items = ref<Reco[]>([]);
  const batchId = ref<string | null>(null);
  const recType = ref('standing');
  const loading = ref(false);
  const generating = ref(false);
  const error = ref<string | null>(null);

  function apply(data: any) {
    items.value = data.items || [];
    batchId.value = data.batch_id ?? null;
    recType.value = data.rec_type || 'standing';
    error.value = data.error || null;
    generating.value = Boolean(data.generating);
    if (data.stale && data.generating) schedulePoll(); // 后端正在后台重生成，静默轮询换新
    else stopPoll();
  }

  // stale=true 表示后端秒回了旧批次、新批次在后台生成中；每 8s 静默 GET 一次直到换上新批，
  // 封顶 40 次（~5 分钟，覆盖 LLM 150s 超时×2 重试）防 LLM 持续故障时空转。
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polls = 0;
  function stopPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    polls = 0;
  }
  function schedulePoll() {
    if (pollTimer) return;
    if (polls >= 40) {
      generating.value = false;
      error.value = 'generation_timeout';
      return;
    }
    pollTimer = setTimeout(async () => {
      pollTimer = null; polls++;
      try { apply(await api('/api/recos')); } catch { schedulePoll(); }
    }, 8000);
  }

  async function load() {
    loading.value = true;
    try { apply(await api('/api/recos')); }
    catch (e) { error.value = e.message || 'load_failed'; }
    finally { loading.value = false; }
  }

  async function refresh() {
    loading.value = true;
    try { apply(await api('/api/recos/refresh', { method: 'POST' })); }
    catch (e) { error.value = e.body?.error || e.message; }
    finally { loading.value = false; }
  }

  async function custom(prompt: any) {
    loading.value = true;
    try { apply(await api('/api/recos/custom', { method: 'POST', body: JSON.stringify({ prompt }) })); }
    catch (e) { error.value = e.body?.error || e.message; }
    finally { loading.value = false; }
  }

  async function feedback(rec: any, emitName: any, priority = 0) {
    const action = ACTION[emitName as keyof typeof ACTION];
    if (!action) return;
    items.value = items.value.filter(i => i.id !== rec.id);   // 本地立即移除
    try {
      await api(`/api/recos/${rec.id}/feedback`, { method: 'POST', body: JSON.stringify({ action, priority }) });
      if (action === 'want') await usePlan().load();              // 进了「想看就一起看」
      else if (action === 'already_seen') await useMarks().load(); // 进了「我已观看」
    } catch (e) { error.value = e.body?.error || e.message; }
  }

  return { items, batchId, recType, loading, generating, error, load, refresh, custom, feedback };
});
