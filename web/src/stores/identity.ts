// web/src/stores/identity.js
//
// 双态身份：
//   me      —— 我自己（cookie loweve_user_id 决定，1 或 2）
//   viewing —— 当前在看的视图（默认=me；可以切到对方视角维护数据）
//
// 切换 me 调用 /api/me/switch 持久化；切换 viewing 只本地，不动 cookie。
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { User } from '../types';

const VIEW_KEY = 'loweve.viewing';

export const useIdentity = defineStore('identity', () => {
  const me = ref<number | null>(null);              // null | 1 | 2
  const viewing = ref<number | null>(null);         // null | 1 | 2，默认跟随 me
  const users = ref<User[]>([]);             // [{id, display_name, avatar}]
  const loaded = ref(false);

  async function load() {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    me.value = data.user_id;
    users.value = data.users;
    const saved = parseInt(localStorage.getItem(VIEW_KEY) || '', 10);
    viewing.value = (saved === 1 || saved === 2) ? saved : (me.value || 1);
    if (!me.value) {
      // 用户从未选过身份，默认设为 1 号
      await switchMe(1);
    }
    loaded.value = true;
  }

  async function switchMe(id) {
    const res = await fetch('/api/me/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ user_id: id }),
    });
    if (res.ok) {
      const data = await res.json();
      me.value = data.user_id;
      setViewing(data.user_id);
    }
  }

  function setViewing(id) {
    viewing.value = id;
    try { localStorage.setItem(VIEW_KEY, String(id)); } catch (_) {}
  }

  function exitProxy() {
    if (me.value) setViewing(me.value);
  }

  async function rename(id, displayName) {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ display_name: displayName }),
    });
    if (!res.ok) throw new Error('rename failed');
    const updated = await res.json();
    const idx = users.value.findIndex(u => u.id === updated.id);
    if (idx >= 0) users.value[idx] = updated;
    return updated;
  }

  const userById = (id) => users.value.find(u => u.id === id);
  const whoKey = (id) => id === 1 ? 'a' : id === 2 ? 'b' : '';   // 用户1/2 的稳定 key（驱动配色 data-who）

  const isViewingPartner = computed(() => me.value != null && viewing.value != null && me.value !== viewing.value);
  const meName = computed(() => userById(me.value)?.display_name || '');
  const viewingName = computed(() => userById(viewing.value)?.display_name || '');
  const meKey = computed(() => whoKey(me.value));
  const viewingKey = computed(() => whoKey(viewing.value));

  return {
    me, viewing, users, loaded,
    load, switchMe, setViewing, exitProxy, rename,
    userById, isViewingPartner, meName, viewingName,
    meKey, viewingKey, whoKey,
  };
});
