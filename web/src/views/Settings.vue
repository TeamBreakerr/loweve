<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { useIdentity } from '../stores/identity';
import { api } from '../api/index';
import type { ApiSettings } from '../types';

const identity = useIdentity();

// 双方显示名本地态——首次进入设置页时同步
const nameA = ref('');
const nameB = ref('');
const saveStatus = ref('');   // '' | 'saving' | 'saved' | 'error'

function syncFromStore() {
  nameA.value = identity.userById(1)?.display_name || '';
  nameB.value = identity.userById(2)?.display_name || '';
}
watch(() => identity.loaded, syncFromStore, { immediate: true });
watch(() => identity.users, syncFromStore, { deep: true });

const canSave = computed(() => {
  const a = nameA.value.trim(), b = nameB.value.trim();
  return a && b && (a !== identity.userById(1)?.display_name || b !== identity.userById(2)?.display_name);
});

async function saveNames() {
  saveStatus.value = 'saving';
  try {
    const tasks: any[] = [];
    if (nameA.value.trim() !== identity.userById(1)?.display_name) {
      tasks.push(identity.rename(1, nameA.value.trim()));
    }
    if (nameB.value.trim() !== identity.userById(2)?.display_name) {
      tasks.push(identity.rename(2, nameB.value.trim()));
    }
    await Promise.all(tasks);
    saveStatus.value = 'saved';
    setTimeout(() => (saveStatus.value = ''), 1800);
  } catch {
    saveStatus.value = 'error';
  }
}

function pickIdentity(id) { identity.switchMe(id); }

// —— 服务配置（LLM / TMDB / Bangumi 凭证）：存服务器、覆盖 env、改完即时生效 ——
const svc = ref<Partial<ApiSettings>>({});   // GET /api/settings（密钥脱敏）
const form = ref({ llm_base_url: '', llm_api_key: '', llm_model: '', tmdb_token: '', tmdb_key: '', bangumi_ua: '' });
const svcSaving = ref(false), svcSaved = ref(false), svcError = ref(false);

async function loadServices() {
  try {
    svc.value = await api('/api/settings');
    form.value.llm_base_url = svc.value.llm_base_url || '';
    form.value.llm_model = svc.value.llm_model || '';
    form.value.bangumi_ua = svc.value.bangumi_ua || '';
  } catch { /* 忽略 */ }
}
onMounted(loadServices);

async function saveServices() {
  svcSaving.value = true; svcError.value = false;
  try {
    const patch: Record<string, string> = {};
    // 非密钥：变了才发（清空=回退 env）；密钥：填了才发（留空=不改）
    if (form.value.llm_base_url !== (svc.value.llm_base_url || '')) patch.llm_base_url = form.value.llm_base_url.trim();
    if (form.value.llm_model !== (svc.value.llm_model || '')) patch.llm_model = form.value.llm_model.trim();
    if (form.value.bangumi_ua !== (svc.value.bangumi_ua || '')) patch.bangumi_ua = form.value.bangumi_ua.trim();
    if (form.value.llm_api_key) patch.llm_api_key = form.value.llm_api_key.trim();
    if (form.value.tmdb_token) patch.tmdb_token = form.value.tmdb_token.trim();
    if (form.value.tmdb_key) patch.tmdb_key = form.value.tmdb_key.trim();
    svc.value = await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
    form.value.llm_api_key = ''; form.value.tmdb_token = ''; form.value.tmdb_key = '';
    svcSaved.value = true; setTimeout(() => (svcSaved.value = false), 1800);
  } catch { svcError.value = true; }
  finally { svcSaving.value = false; }
}
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回首页
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Settings</span>
      <h1 class="page-hero__title">设置</h1>
      <p class="page-hero__lead">身份、显示名、服务配置（LLM / TMDB 凭证），以及评分来源状态。只你们俩可见。</p>
    </div>

    <div class="settings-list">
      <!-- 当前身份 -->
      <section class="setting">
        <div class="setting__head">
          <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
          <span class="setting__title">当前身份</span>
        </div>
        <p class="setting__desc">选择"我是谁"。顶栏也能随时切换；切到对方时整条顶栏会变暖色高亮，提醒你在代为维护。</p>
        <div class="identity-pick">
          <button
            v-for="u in identity.users" :key="u.id"
            class="identity-card"
            :class="{ 'is-active': identity.me === u.id }"
            :data-who="identity.whoKey(u.id)"
            @click="pickIdentity(u.id)"
          >
            <span class="identity-card__avatar">{{ u.display_name?.[0] || '' }}</span>
            <div>
              <div class="record__who">{{ u.display_name }}</div>
              <div class="record__role">用户 {{ u.id }}</div>
            </div>
          </button>
        </div>
      </section>

      <!-- 显示名 -->
      <section class="setting">
        <div class="setting__head">
          <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          <span class="setting__title">显示名</span>
        </div>
        <p class="setting__desc">界面上看到的名字。改完点保存。</p>
        <div class="setting__row">
          <input class="input" type="text" v-model="nameA" placeholder="用户 A 的显示名" />
          <input class="input" type="text" v-model="nameB" placeholder="用户 B 的显示名" />
          <button class="btn btn--rose" :disabled="!canSave || saveStatus === 'saving'" @click="saveNames">
            {{ saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存 ✓' : '保存' }}
          </button>
        </div>
        <p v-if="saveStatus === 'error'" style="color:var(--rose-bright);margin-top:8px;font-size:var(--fs-sm)">保存失败，请重试。</p>
      </section>

      <!-- 服务配置（凭证）-->
      <section class="setting">
        <div class="setting__head">
          <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
          <span class="setting__title">服务配置</span>
        </div>
        <p class="setting__desc">凭证存在服务器本地（覆盖部署时的环境变量），改完即时生效。密钥不回显，留空表示不修改。</p>

        <div class="cfg-group">
          <div class="cfg-group__title">
            AI 推荐（LLM，OpenAI 兼容端点）
            <span v-if="svc.llm_ready" class="badge-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg>已就绪</span>
            <span v-else class="badge-off">未配置</span>
          </div>
          <input class="input" type="text" v-model="form.llm_base_url" placeholder="Base URL，如 https://your-host/v1" />
          <input class="input" type="password" autocomplete="off" v-model="form.llm_api_key" :placeholder="svc.llm_api_key_set ? '•••• 已配置（留空不改）' : 'API Key'" />
          <input class="input" type="text" v-model="form.llm_model" placeholder="模型名，如 gpt-4o / gemini-2.5-pro" />
        </div>

        <div class="cfg-group">
          <div class="cfg-group__title">
            TMDB 凭证（检索影视，Token / Key 二选一）
            <span v-if="svc.tmdb_ready" class="badge-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg>已就绪</span>
            <span v-else class="badge-off">未配置</span>
          </div>
          <input class="input" type="password" autocomplete="off" v-model="form.tmdb_token" :placeholder="svc.tmdb_token_set ? '•••• v4 Token 已配置（留空不改）' : 'v4 Bearer Token（优先）'" />
          <input class="input" type="password" autocomplete="off" v-model="form.tmdb_key" :placeholder="svc.tmdb_key_set ? '•••• v3 Key 已配置（留空不改）' : 'v3 API Key（备选）'" />
        </div>

        <div class="cfg-group">
          <div class="cfg-group__title">Bangumi User-Agent</div>
          <input class="input" type="text" v-model="form.bangumi_ua" placeholder="如 loweve/1.0" />
        </div>

        <button class="btn btn--rose" :disabled="svcSaving" @click="saveServices">
          {{ svcSaving ? '保存中…' : svcSaved ? '已保存 ✓' : '保存配置' }}
        </button>
        <p v-if="svcError" style="color:var(--rose-bright);margin-top:8px;font-size:var(--fs-sm)">保存失败，请重试。</p>
      </section>

      <!-- 豆瓣 -->
      <section class="setting">
        <div class="setting__head">
          <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>
          <span class="setting__title">豆瓣 · 电影评分</span>
        </div>
        <p class="setting__desc">电影的评分和海报会自动从豆瓣公开页面抓取，无需登录。加电影后会先显示 TMDB 数据，后台约半分钟内升级；抓不到时继续使用 TMDB 兜底。</p>
        <span class="badge-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg>自动启用</span>
      </section>

      <!-- Bangumi -->
      <section class="setting">
        <div class="setting__head">
          <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>
          <span class="setting__title">Bangumi · 番剧评分</span>
        </div>
        <p class="setting__desc">番剧的评分和封面会自动来自 <a href="https://bgm.tv" target="_blank" rel="noreferrer" style="color:var(--bangumi)">Bangumi</a> 公开数据，无需登录或配置。加番剧时自动匹配，匹配不到则用 TMDB 评分兜底。</p>
        <span class="badge-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg>已启用</span>
      </section>

      <!-- 关于 -->
      <section class="setting" style="text-align:center;color:var(--text-faint)">
        <div class="brand__mark" style="font-size:22px">loweve</div>
        <p style="margin-top:6px;font-size:var(--fs-sm)">小放映厅 · v1.0 · 为 {{ identity.userById(1)?.display_name || 'A' }} &amp; {{ identity.userById(2)?.display_name || 'B' }} 而做</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.cfg-group { margin: var(--s-4) 0; }
.cfg-group__title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-dim); margin-bottom: 8px; }
.cfg-group .input { width: 100%; margin-bottom: 6px; }
.badge-off { font-size: 11px; color: var(--text-faint); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 1px 9px; }
</style>
