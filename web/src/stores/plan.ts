// web/src/stores/plan.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index';
import type { PlanItem } from '../types';

export const usePlan = defineStore('plan', () => {
  const list = ref<PlanItem[]>([]);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const data = await api('/api/plan');
      list.value = data.items;
    } finally { loading.value = false; }
  }

  async function add(payload: any) {
    await api('/api/plan', { method: 'POST', body: JSON.stringify(payload) });
    await load();
  }

  async function update(id: any, patch: any) {
    const updated = await api(`/api/plan/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const idx = list.value.findIndex(p => p.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], ...updated };
    return updated;
  }

  async function remove(id: any) {
    await api(`/api/plan/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(p => p.id !== id);
  }

  return { list, loading, load, add, update, remove };
});
