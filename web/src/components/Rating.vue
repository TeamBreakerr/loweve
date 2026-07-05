<script setup lang="ts">
defineProps({
  source: { type: String, required: true, validator: (v: string) => ['douban','bangumi','tmdb'].includes(v) },
  score: { type: [Number, String], required: true },
  href: { type: String, default: '' },   // 给了就渲染成可点链接，跳到该平台条目
});
const LABEL = { douban: '豆瓣', bangumi: 'Bangumi', tmdb: 'TMDB' };
</script>

<template>
  <a v-if="href" class="rating rating--link" :class="`rating--${source}`" :href="href"
     target="_blank" rel="noreferrer" :data-tip="`在${LABEL[source as keyof typeof LABEL] || source}查看条目`" @click.stop>
    <span class="rating__src">{{ LABEL[source as keyof typeof LABEL] || source }}</span>
    <span class="rating__num">{{ score }}</span>
  </a>
  <span v-else class="rating" :class="`rating--${source}`">
    <span class="rating__src">{{ LABEL[source as keyof typeof LABEL] || source }}</span>
    <span class="rating__num">{{ score }}</span>
  </span>
</template>

<style scoped>
/* 从 styles/loweve.css「评分徽标」段搬入（T10 批 5，纯剪切，未改声明）。rating--douban/
   rating--bangumi 由上面 `:class="`rating--${source}`"` 动态拼出，scoped 对动态类名同样
   生效（见 css-usage-report.txt 人工复核）。*/
.rating{
  display:inline-flex; align-items:center; gap:6px;
  background:var(--surface-2); border:1px solid var(--line-soft);
  border-radius:var(--r-pill); padding:3px 10px 3px 4px;
}
/* 可点击的评分（链到豆瓣/Bangumi 条目）*/
a.rating--link{ text-decoration:none; cursor:pointer; transition:border-color .15s, transform .12s; }
a.rating--link:hover{ border-color:var(--line); transform:translateY(-1px); }
a.rating--link:active{ transform:none; }
.rating__src{
  font-size:10px; letter-spacing:.02em; font-weight:500;
  padding:2px 6px; border-radius:var(--r-pill);
}
.rating--douban .rating__src{ color:oklch(0.16 0.04 150); background:var(--douban); font-weight:600; }
.rating--bangumi .rating__src{ color:oklch(0.16 0.04 350); background:var(--bangumi); font-weight:600; }
.rating__num{
  font-family:var(--font-brand); font-weight:600; font-style:italic;
  font-size:var(--fs-md); line-height:1; color:var(--gold);
  letter-spacing:.02em;
}
</style>
