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

  async function add(payload) {
    await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) });
    await load();
  }

  async function update(id, patch) {
    const updated = await api(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const idx = list.value.findIndex(s => s.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  async function remove(id) {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(s => s.id !== id);
  }

  return { list, loading, load, add, update, remove };
});
