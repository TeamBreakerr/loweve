import { resolveTmdbCandidate } from './validate.js';
import { customAllowsDlc, customAllowsSolo, customAllowsUnreleased } from '../games/prompt.js';

// 只允许结构化筛选；模型不能提供 URL、SQL、作品 ID 或评分作为检索依据。
export const MOVIE_GENRES: Record<string, number> = {
  动作: 28, 冒险: 12, 动画: 16, 喜剧: 35, 犯罪: 80, 纪录: 99, 剧情: 18, 家庭: 10751,
  奇幻: 14, 历史: 36, 恐怖: 27, 音乐: 10402, 悬疑: 9648, 爱情: 10749, 科幻: 878, 惊悚: 53, 战争: 10752, 西部: 37,
};
export const GAME_GENRES: Record<string, number> = { 格斗: 4, 射击: 5, 音乐: 7, 平台: 8, 解谜: 9, 竞速: 10, 即时战略: 11, RPG: 12, 模拟: 13, 体育: 14, 策略: 15, 回合制: 16, 战术: 24, 冒险: 31, 独立: 32, 视觉小说: 34 };
export const GAME_THEMES: Record<string, number> = { 动作: 1, 奇幻: 17, 科幻: 18, 恐怖: 19, 惊悚: 20, 生存: 21, 历史: 22, 潜行: 23, 喜剧: 27, 沙盒: 31, 开放世界: 38 };
export const PLATFORMS: Record<string, number> = { PC: 6, Switch: 130, PS4: 48, PS5: 167, XboxOne: 49, XboxSeries: 169 };

export type DiscoveryPlan = {
  source: 'tmdb' | 'bangumi' | 'igdb' | 'steam'; kind: 'movie' | 'tv' | 'all';
  order: 'personalized' | 'score' | 'rank'; count: number; genres: string[]; excludeGenres: string[];
  themes: string[]; platforms: string[]; tags: string[]; minVotes: number; minScore: number;
  yearFrom?: number; yearTo?: number; maxRuntime?: number; offset: number;
};
export type Candidate = {
  id: string; title: string; original_title?: string | null; year: number | null; type?: 'movie' | 'tv';
  source: string; url: string; score: number | null; votes: number | null; rank?: number | null;
  taste_tier?: number; together_tier?: number; overview?: string; hit?: { tmdb_id: number; tmdb_type: string }; game?: any; reason?: string;
};

export function discoveryError(message: string) {
  return Object.assign(new Error(message), { code: 'discovery_failed' });
}

function strings(value: any): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v: any) => typeof v === 'string' && v.length <= 40))].slice(0, 8) as string[] : [];
}
function number(value: any, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
export function normalizePlan(raw: any, domain: 'movie' | 'game'): DiscoveryPlan {
  if (!raw || typeof raw !== 'object') throw discoveryError('无法解析检索条件，请明确题材、平台或评分要求。');
  const supported = new Set(['source', 'kind', 'order', 'count', 'genres', 'excludeGenres', 'themes', 'platforms', 'tags', 'minVotes', 'minScore', 'yearFrom', 'yearTo', 'maxRuntime', 'offset', 'unsupported']);
  if (Object.keys(raw).some(k => !supported.has(k))) throw discoveryError('包含接口不支持的筛选字段，请查详情核实或明确说明限制。');
  if (raw.unsupported) throw discoveryError(`暂不能可靠查询：${String(raw.unsupported).slice(0, 160)}`);
  if (!['tmdb', 'bangumi', 'igdb', 'steam'].includes(raw.source)) throw discoveryError('该数据源尚未提供可靠的条件检索接口。');
  const source = raw.source as DiscoveryPlan['source'];
  if (domain === 'movie' ? !['tmdb', 'bangumi'].includes(source) : !['igdb', 'steam'].includes(source)) throw discoveryError('该数据源不适用于当前推荐类别。');
  const genres = strings(raw.genres), excludeGenres = strings(raw.excludeGenres);
  const dict = domain === 'movie' ? MOVIE_GENRES : GAME_GENRES;
  if ([...genres, ...excludeGenres].some(g => !(g in dict))) throw discoveryError('检索包含暂不支持的类型，请换用常见题材名称。');
  const themes = strings(raw.themes), platforms = strings(raw.platforms);
  if (themes.some(g => !(g in GAME_THEMES)) || platforms.some(g => !(g in PLATFORMS))) throw discoveryError('暂不支持这个游戏题材或平台筛选。');
  if (domain === 'movie' && (themes.length || platforms.length || (source === 'tmdb' && strings(raw.tags).length))) throw discoveryError('该影视接口不支持这些标签或平台条件，请改用类型筛选或详情查询。');
  if (domain === 'game' && (excludeGenres.length || raw.maxRuntime != null)) throw discoveryError('游戏检索暂不支持排除类型或片长条件。');
  const order: DiscoveryPlan['order'] = ['score', 'rank'].includes(raw.order) ? raw.order : 'personalized';
  const yearFrom = typeof raw.yearFrom === 'number' ? Math.trunc(number(raw.yearFrom, 1900, 1870, 2100)) : undefined;
  const yearTo = typeof raw.yearTo === 'number' ? Math.trunc(number(raw.yearTo, 2100, 1870, 2100)) : undefined;
  if (yearFrom && yearTo && yearFrom > yearTo) throw discoveryError('起始年份不能晚于结束年份。');
  return {
    offset: Math.trunc(number(raw.offset, 0, 0, 800)), source, kind: ['movie', 'tv'].includes(raw.kind) ? raw.kind : 'all', order,
    count: Math.trunc(number(raw.count, 9, 1, 30)), genres, excludeGenres, themes, platforms,
    tags: strings(raw.tags), minVotes: Math.trunc(number(raw.minVotes, source === 'bangumi' ? 0 : domain === 'movie' ? 100 : 20, 0, 1_000_000)),
    minScore: number(raw.minScore, 0, 0, domain === 'movie' ? 10 : 100), yearFrom, yearTo,
    maxRuntime: typeof raw.maxRuntime === 'number' ? Math.trunc(number(raw.maxRuntime, 180, 1, 1000)) : undefined,
  };
}

export async function retrieveMovies(deps: any, plan: DiscoveryPlan): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const target = plan.order === 'personalized' ? 80 : plan.count;
  if (plan.source === 'bangumi') {
    if (plan.maxRuntime) throw discoveryError('Bangumi 暂不支持片长筛选。');
    const filter: any = { rank: ['>0'], rating: [`>=${plan.minScore}`], rating_count: [`>=${plan.minVotes}`] };
    const tags = [...plan.tags, ...plan.genres, ...plan.excludeGenres.map(g => `-${g}`)];
    if (plan.kind === 'movie') tags.push('剧场版');
    if (plan.kind === 'tv') tags.push('TV');
    if (tags.length) filter.meta_tags = [...new Set(tags)];
    filter.air_date = [`<=${new Date().toISOString().slice(0, 10)}`];
    if (plan.yearFrom) filter.air_date.push(`>=${plan.yearFrom}-01-01`);
    if (plan.yearTo) filter.air_date.push(`<=${plan.yearTo}-12-31`);
    for (let offset = plan.offset; offset < plan.offset + 100 && out.length < target; offset += 20) {
      const data = await deps.bangumi.discoverAnime({ sort: plan.order === 'score' ? 'score' : 'rank', filter, offset });
      for (const s of data.items) {
        if ((plan.kind === 'movie' && s.platform !== '剧场版') || (plan.kind === 'tv' && s.platform !== 'TV')) continue;
        out.push({ id: `bangumi:${s.bangumi_id}`, source: 'Bangumi', title: s.name_cn || s.name,
          original_title: s.name, year: s.year, type: s.platform === '剧场版' ? 'movie' : 'tv',
          score: s.score, votes: s.votes, rank: s.rank, url: s.url, overview: String(s.summary).slice(0, 1000) });
      }
      if (!data.items.length || offset + 20 >= data.total) break;
    }
  } else {
    const kinds: Array<'movie' | 'tv'> = plan.kind === 'all' ? ['movie', 'tv'] : [plan.kind];
    for (const kind of kinds) {
      const genreId = (name: string) => {
        if (kind === 'movie') return MOVIE_GENRES[name];
        const tv: Record<string, number> = { 动作: 10759, 冒险: 10759, 动画: 16, 喜剧: 35, 犯罪: 80, 纪录: 99, 剧情: 18, 家庭: 10751, 科幻: 10765, 奇幻: 10765, 悬疑: 9648, 战争: 10768, 西部: 37 };
        if (!tv[name]) throw discoveryError(`TMDB 剧集不支持「${name}」类型筛选，请指定电影。`);
        return tv[name];
      };
      const params: Record<string, string> = { sort_by: 'vote_average.desc', 'vote_count.gte': String(plan.minVotes), 'vote_average.gte': String(plan.minScore) };
      if (plan.genres.length) params.with_genres = plan.genres.map(genreId).join(',');
      if (plan.excludeGenres.length) params.without_genres = plan.excludeGenres.map(genreId).join(',');
      const date = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
      params[`${date}.lte`] = plan.yearTo ? `${plan.yearTo}-12-31` : new Date().toISOString().slice(0, 10);
      if (plan.yearFrom) params[`${date}.gte`] = `${plan.yearFrom}-01-01`;
      if (plan.maxRuntime) params['with_runtime.lte'] = String(plan.maxRuntime);
      for (let page = 1 + Math.floor(plan.offset / 20); page <= Math.floor(plan.offset / 20) + (plan.order === 'personalized' ? 3 : Math.ceil(plan.count / 20)); page++) {
        const data = await deps.tmdb.discover(kind, { ...params, page: String(page) });
        for (const s of data.results) out.push({ id: `tmdb:${kind}:${s.tmdb_id}`, title: s.title,
          original_title: s.original_title, year: s.year, type: kind, source: 'TMDB',
          score: s.vote_average, votes: s.vote_count, overview: String(s.overview || '').slice(0, 1000),
          url: `https://www.themoviedb.org/${kind}/${s.tmdb_id}`, hit: { tmdb_id: s.tmdb_id, tmdb_type: kind } });
        if (!data.results.length || page * 20 >= data.total) break;
      }
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  return [...new Map(out.map(c => [c.id, c])).values()];
}

export async function retrieveGames(deps: any, plan: DiscoveryPlan, prompt: string | null): Promise<Candidate[]> {
  if (plan.source === 'steam') {
    if (plan.platforms.some(p => p !== 'PC')) throw discoveryError('Steam检索仅支持PC，主机平台请使用IGDB。');
    const tagNames = [...new Set([...plan.tags, ...plan.genres.map(g => g === 'RPG' ? '角色扮演' : g), ...plan.themes,
      ...(!customAllowsSolo(prompt) ? ['多人'] : [])])];
    const data = await deps.steam.discover({ tagNames, offset: plan.offset });
    return data.results.filter((g: any) => g.review_percent != null && g.review_percent >= plan.minScore
      && g.review_total >= plan.minVotes && (!plan.yearFrom || g.release_year >= plan.yearFrom)
      && (!plan.yearTo || g.release_year <= plan.yearTo)).map((game: any) => ({
      id: `steam:${game.steam_appid}`, source: 'Steam', title: game.title, original_title: game.original_title,
      year: game.release_year, game, score: game.review_percent, votes: game.review_total,
      overview: String(game.short_description || '').slice(0, 1000), url: `https://store.steampowered.com/app/${game.steam_appid}/`,
    }));
  }
  if (!deps.igdb?.isConfigured?.()) throw discoveryError('游戏条件检索需要先在设置中配置 IGDB。');
  if (plan.excludeGenres.length || plan.tags.length) throw discoveryError('暂不支持游戏的排除类型或自由标签筛选。');
  const out: Candidate[] = [];
  for (let offset = plan.offset; offset < plan.offset + 50; offset += 50) {
    const data = await deps.igdb.discover({ genres: plan.genres.map(g => GAME_GENRES[g]), themes: plan.themes.map(g => GAME_THEMES[g]),
      platforms: plan.platforms.map(g => PLATFORMS[g]), together: !customAllowsSolo(prompt), allowDlc: customAllowsDlc(prompt),
      allowUnreleased: customAllowsUnreleased(prompt), minVotes: plan.minVotes, minScore: plan.minScore,
      yearFrom: plan.yearFrom, yearTo: plan.yearTo, offset });
    for (const game of data.results) out.push({ id: `igdb:${game.igdb_id}`, source: 'IGDB', title: game.title,
      original_title: game.original_title, year: game.release_year, game, score: game.catalog_rating,
      votes: game.catalog_rating_count, url: game.igdb_url, overview: String(game.short_description || '').slice(0, 1000) });
    if (data.results.length < 50) break;
  }
  return [...new Map(out.map(c => [c.id, c])).values()];
}

export async function movieIdentity(deps: any, candidate: Candidate) {
  if (candidate.hit) return candidate.hit;
  const match = async (title: string) => resolveTmdbCandidate(deps.tmdb, {
    title, year: candidate.year, type: candidate.type, strictType: true,
  });
  let hit = await match(candidate.title);
  if (!hit && candidate.original_title) hit = await match(candidate.original_title);
  // 来源明确的电影不能被替换成剧集，也不能把不同年份的同名作品混进榜单。
  if (!hit || hit.tmdb_type !== candidate.type || (candidate.year && Math.abs(hit.year - candidate.year) > 1)) return null;
  return { tmdb_id: hit.tmdb_id, tmdb_type: hit.tmdb_type };
}

export function evidenceReason(c: Candidate) {
  return `${c.source} ${c.score == null ? '暂无评分' : `${c.score}${c.source === 'Steam' ? '%好评' : '分'}`} · ${c.votes == null ? '评价人数未知' : `${c.votes}人评价`}${c.rank ? ` · 站内排名${c.rank}` : ''}`;
}
