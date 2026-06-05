// web/src/stores/plan.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index.js';

export const usePlan = defineStore('plan', () => {
  const list = ref([]);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const data = await api('/api/plan');
      list.value = data.items;
    } finally { loading.value = false; }
  }

  async function add(payload) {
    await api('/api/plan', { method: 'POST', body: JSON.stringify(payload) });
    await load();
  }

  async function update(id, patch) {
    const updated = await api(`/api/plan/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const idx = list.value.findIndex(p => p.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  async function remove(id) {
    await api(`/api/plan/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(p => p.id !== id);
  }

  return { list, loading, load, add, update, remove };
});
