// web/src/stores/marks.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { api } from '../api/index.js';
import { useIdentity } from './identity.js';

export const useMarks = defineStore('marks', () => {
  const list = ref([]);     // 当前 viewing 的全部 marks（含 work join）
  const loading = ref(false);

  const watched = computed(() => list.value.filter(m => m.status === 'watched'));
  const wish    = computed(() => list.value.filter(m => m.status === 'wish'));

  async function load() {
    loading.value = true;
    try {
      const data = await api('/api/marks');
      list.value = data.marks;
    } finally { loading.value = false; }
  }

  async function add(payload) {
    const created = await api('/api/marks', { method: 'POST', body: JSON.stringify(payload) });
    // 重新拉一次以拿到 work join
    await load();
    return created;
  }

  async function update(id, patch) {
    const updated = await api(`/api/marks/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const idx = list.value.findIndex(m => m.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  async function remove(id) {
    await api(`/api/marks/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(m => m.id !== id);
  }

  // viewing 切换 → 重载（marks 是 per-user）
  function bindIdentityWatcher() {
    const identity = useIdentity();
    watch(() => identity.viewing, () => { if (identity.loaded) load(); });
  }

  return { list, watched, wish, loading, load, add, update, remove, bindIdentityWatcher };
});
