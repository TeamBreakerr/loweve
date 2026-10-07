// web/src/stores/sessions.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index';
import type { Session } from '../types';

export const useSessions = defineStore('sessions', () => {
  const list = ref<Session[]>([]);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const data = await api('/api/sessions');
      list.value = data.sessions;
    } finally { loading.value = false; }
  }

  async function add(payload: any) {
    await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) });
    await load();
  }

  async function update(id: any, patch: any) {
    const updated = await api(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const idx = list.value.findIndex(s => s.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  // 点评室：两人点评 + 讨论纪要一次保存（录音生成的草稿确认后也走这里）
  async function jointReview(id: number, payload: any) {
    const updated = await api(`/api/sessions/${id}/joint-review`, { method: 'PUT', body: JSON.stringify(payload) });
    const idx = list.value.findIndex(s => s.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  async function remove(id: any) {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(s => s.id !== id);
  }

  return { list, loading, load, add, update, jointReview, remove };
});
