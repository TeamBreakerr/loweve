import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index';
import type { GameMark } from '../types';

export const useGameMarks = defineStore('game-marks', () => {
  const list = ref<GameMark[]>([]);
  const loading = ref(false);
  async function load() {
    loading.value = true;
    try { list.value = (await api('/api/games/marks')).marks || []; }
    finally { loading.value = false; }
  }
  async function update(id: number, patch: any) {
    const item = await api(`/api/games/marks/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const index = list.value.findIndex(row => row.id === id);
    if (index >= 0) list.value[index] = { ...list.value[index], ...item };
  }
  async function remove(id: number) {
    await api(`/api/games/marks/${id}`, { method: 'DELETE' });
    list.value = list.value.filter(row => row.id !== id);
  }
  return { list, loading, load, update, remove };
});
