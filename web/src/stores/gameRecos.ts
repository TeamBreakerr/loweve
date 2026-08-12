import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/index';
import { useGameMarks } from './gameMarks';
import { useGamePlan } from './gamePlan';
import type { GameReco } from '../types';

const ACTION = { want: 'want', no: 'not_interested', seen: 'already_seen' };

export const useGameRecos = defineStore('game-recos', () => {
  const items = ref<GameReco[]>([]);
  const loading = ref(false);
  const generating = ref(false);
  const error = ref<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polls = 0;

  function stopPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null; polls = 0;
  }
  function apply(data: any) {
    items.value = data.items || [];
    generating.value = Boolean(data.generating);
    error.value = data.error || null;
    if (data.stale && data.generating) schedulePoll(); else stopPoll();
  }
  function schedulePoll() {
    if (pollTimer) return;
    if (polls >= 40) { generating.value = false; error.value = 'generation_timeout'; return; }
    pollTimer = setTimeout(async () => {
      pollTimer = null; polls++;
      try { apply(await api('/api/games/recos')); } catch { schedulePoll(); }
    }, 8000);
  }
  async function call(url: string, opts: RequestInit = {}) {
    loading.value = true;
    try { apply(await api(url, opts)); }
    catch (e) { error.value = e.body?.error || e.message; }
    finally { loading.value = false; }
  }
  const load = () => call('/api/games/recos');
  const refresh = () => call('/api/games/recos/refresh', { method: 'POST' });
  const custom = (prompt: string) => call('/api/games/recos/custom', { method: 'POST', body: JSON.stringify({ prompt }) });
  async function feedback(rec: GameReco, emitName: keyof typeof ACTION, priority = 0) {
    const action = ACTION[emitName];
    if (!action) return;
    items.value = items.value.filter(item => item.id !== rec.id);
    try {
      await api(`/api/games/recos/${rec.id}/feedback`, { method: 'POST', body: JSON.stringify({ action, priority }) });
      if (action === 'want') await useGamePlan().load();
      if (action === 'already_seen') await useGameMarks().load();
    } catch (e) { error.value = e.body?.error || e.message; }
  }
  return { items, loading, generating, error, load, refresh, custom, feedback };
});
