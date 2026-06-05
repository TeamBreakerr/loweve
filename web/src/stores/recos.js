// web/src/stores/recos.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index.js';
import { usePlan } from './plan.js';
import { useMarks } from './marks.js';

// 反馈按钮 emit → 后端 action
const ACTION = { want: 'want', no: 'not_interested', seen: 'already_seen' };

export const useRecos = defineStore('recos', () => {
  const items = ref([]);
  const batchId = ref(null);
  const recType = ref('standing');
  const loading = ref(false);
  const error = ref(null);

  function apply(data) {
    items.value = data.items || [];
    batchId.value = data.batch_id ?? null;
    recType.value = data.rec_type || 'standing';
    error.value = data.error || null;
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

  async function custom(prompt) {
    loading.value = true;
    try { apply(await api('/api/recos/custom', { method: 'POST', body: JSON.stringify({ prompt }) })); }
    catch (e) { error.value = e.body?.error || e.message; }
    finally { loading.value = false; }
  }

  async function feedback(rec, emitName) {
    const action = ACTION[emitName];
    if (!action) return;
    items.value = items.value.filter(i => i.id !== rec.id);   // 本地立即移除
    try {
      await api(`/api/recos/${rec.id}/feedback`, { method: 'POST', body: JSON.stringify({ action }) });
      if (action === 'want') await usePlan().load();              // 进了「想看就一起看」
      else if (action === 'already_seen') await useMarks().load(); // 进了「我已观看」
    } catch (e) { error.value = e.body?.error || e.message; }
  }

  return { items, batchId, recType, loading, error, load, refresh, custom, feedback };
});
