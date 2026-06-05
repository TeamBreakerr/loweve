<script setup>
defineProps({
  source: { type: String, required: true, validator: v => ['douban','bangumi','tmdb'].includes(v) },
  score: { type: [Number, String], required: true },
  href: { type: String, default: '' },   // 给了就渲染成可点链接，跳到该平台条目
});
const LABEL = { douban: '豆瓣', bangumi: 'Bangumi', tmdb: 'TMDB' };
</script>

<template>
  <a v-if="href" class="rating rating--link" :class="`rating--${source}`" :href="href"
     target="_blank" rel="noreferrer" :title="`在${LABEL[source] || source}查看条目`" @click.stop>
    <span class="rating__src">{{ LABEL[source] || source }}</span>
    <span class="rating__num">{{ score }}</span>
  </a>
  <span v-else class="rating" :class="`rating--${source}`">
    <span class="rating__src">{{ LABEL[source] || source }}</span>
    <span class="rating__num">{{ score }}</span>
  </span>
</template>
