// server/src/tmdb/mapper.js
// TMDB payload → loweve works 表字段

export function isAnime(payload: any) {
  const genreIds = (payload.genres || []).map((g: any) => g.id);
  const hasAnimation = genreIds.includes(16);
  const origins = payload.origin_country || [];
  const isAsian = origins.some((c: any) => ['JP','CN','KR'].includes(c));
  return (hasAnimation && isAsian) ? 1 : 0;
}

function posterUrl(path: any) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

// 收集"别名"：英文官方名（translations.en）+ 英语区 AKA（alternative_titles US/GB）。
// 给豆瓣/Bangumi 匹配多比一道，避免「赛博朋克边缘行者」这类中/日文都对不上、但英文名能对上的情况。
function extractAkas(payload: any, type: any) {
  const out = new Set<string>();
  for (const t of payload.translations?.translations || []) {
    if (t.iso_639_1 === 'en') {
      const n = type === 'tv' ? t.data?.name : t.data?.title;
      if (n && n.trim()) out.add(n.trim());
    }
  }
  const alt = type === 'tv' ? (payload.alternative_titles?.results || []) : (payload.alternative_titles?.titles || []);
  for (const a of alt) {
    if (['US', 'GB'].includes(a.iso_3166_1) && a.title && a.title.trim()) out.add(a.title.trim());
  }
  return [...out].slice(0, 8);
}

function commonFields(payload: any, tmdb_type: any) {
  return {
    tmdb_id: payload.id,
    tmdb_type,
    overview: payload.overview || null,
    aka_titles: JSON.stringify(extractAkas(payload, tmdb_type)),
    genres: JSON.stringify((payload.genres || []).map((g: any) => g.name)),
    is_anime: isAnime(payload),
    primary_rating: typeof payload.vote_average === 'number' ? payload.vote_average : null,
    primary_rating_count: typeof payload.vote_count === 'number' ? payload.vote_count : null,
    primary_poster_url: posterUrl(payload.poster_path),
    rating_source: 'tmdb',
    bangumi_id: null,
    douban_id: null,
    douban_url: null,
    imdb_id: payload.external_ids?.imdb_id || null,
    tmdb_raw: JSON.stringify(payload),
    bangumi_raw: null,
    douban_raw: null,
  };
}

export function mapMovie(payload: any) {
  return {
    ...commonFields(payload, 'movie'),
    title: payload.title || payload.original_title || '',
    original_title: payload.original_title || null,
    year: parseInt((payload.release_date || '').slice(0, 4), 10) || null,
    runtime: payload.runtime || null,
  };
}

export function mapTv(payload: any) {
  return {
    ...commonFields(payload, 'tv'),
    title: payload.name || payload.original_name || '',
    original_title: payload.original_name || null,
    year: parseInt((payload.first_air_date || '').slice(0, 4), 10) || null,
    runtime: payload.episode_run_time?.[0] || null,
  };
}
