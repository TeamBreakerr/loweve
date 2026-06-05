// server/src/tmdb/mapper.js
// TMDB payload → loweve works 表字段

export function isAnime(payload) {
  const genreIds = (payload.genres || []).map(g => g.id);
  const hasAnimation = genreIds.includes(16);
  const origins = payload.origin_country || [];
  const isAsian = origins.some(c => ['JP','CN','KR'].includes(c));
  return (hasAnimation && isAsian) ? 1 : 0;
}

function posterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

function commonFields(payload, tmdb_type) {
  return {
    tmdb_id: payload.id,
    tmdb_type,
    overview: payload.overview || null,
    genres: JSON.stringify((payload.genres || []).map(g => g.name)),
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

export function mapMovie(payload) {
  return {
    ...commonFields(payload, 'movie'),
    title: payload.title || payload.original_title || '',
    original_title: payload.original_title || null,
    year: parseInt((payload.release_date || '').slice(0, 4), 10) || null,
    runtime: payload.runtime || null,
  };
}

export function mapTv(payload) {
  return {
    ...commonFields(payload, 'tv'),
    title: payload.name || payload.original_name || '',
    original_title: payload.original_name || null,
    year: parseInt((payload.first_air_date || '').slice(0, 4), 10) || null,
    runtime: payload.episode_run_time?.[0] || null,
  };
}
