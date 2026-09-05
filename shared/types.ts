// 前后端共享的 API 数据形状。web 经 src/types.ts 重导出；server 在路由标注响应类型（T18）。
export type RatingSource = 'douban' | 'bangumi' | 'tmdb';

export interface WorkDetails {
  backdrop_url?: string | null;
  tagline?: string | null;
  release_date?: string | null;
  status?: string | null;
  original_language?: string | null;
  countries?: string[];
  spoken_languages?: string[];
  production_companies?: string[];
  directors?: string[];
  cast?: { name: string; character?: string | null }[];
  tmdb_rating?: number | null;
  tmdb_rating_count?: number | null;
  douban_rating?: number | null;
  douban_rating_count?: number | null;
  bangumi_rating?: number | null;
  bangumi_rating_count?: number | null;
  trailer_url?: string | null;
  homepage?: string | null;
  imdb_id?: string | null;
  tmdb_url?: string | null;
}

export interface HotReview {
  id: string;
  author: string;
  avatar_url?: string | null;
  content: string;
  rating?: number | null;
  votes?: number | null;
  created_at?: string | null;
  url?: string | null;
  sentiment?: 'positive' | 'negative' | null;
  playtime_hours?: number | null;
}

export interface HotReviewResponse {
  source: 'douban' | 'bangumi' | 'steam' | 'igdb' | null;
  source_label: string | null;
  source_url?: string | null;
  reviews: HotReview[];
}

export interface Work {
  id: number;
  tmdb_id: number;
  tmdb_type: 'movie' | 'tv';
  season_number?: number | null;   // NULL/缺省=整部剧；N≥1=第N季
  title: string;
  original_title?: string | null;
  year?: number | null;
  is_anime?: number;
  genres?: string | null;
  runtime?: number | null;
  overview?: string | null;
  primary_poster_url?: string;
  primary_rating?: number | null;
  primary_rating_count?: number | null;
  rating_source: RatingSource;
  douban_id?: string | null;
  douban_url?: string | null;
  bangumi_id?: number | null;
  all_marks: Mark[];
  sessions: Session[];
  plan?: PlanItem | null;
  my_mark?: Mark | null;
  details?: WorkDetails;
}

export interface Mark {
  id: number;
  user_id: number;
  work_id: number;
  status: 'watched' | 'wish';
  rating?: number | null;
  comment?: string | null;
  marked_at?: number;
  work: Work;
}

export interface Session {
  id: number;
  work_id: number;
  watched_at?: number | null;
  rating_a?: number | null;
  rating_b?: number | null;
  review_a?: string | null;
  review_b?: string | null;
  joint_note?: string | null;
  work: Work;
}

export interface PlanItem {
  id: number;
  work_id: number;
  status: 'pending' | 'watching' | 'done' | 'dropped';
  note?: string | null;
  priority?: number;
  added_by?: number;
  work: Work;
}

export type TrashEntityType = 'mark' | 'session' | 'plan';

export interface TrashItem {
  id: number;
  entity_type: TrashEntityType;
  entity_id: number;
  work_id: number;
  payload: Record<string, any>;
  deleted_at: number;
  deleted_by?: number | null;
  deleted_by_name?: string | null;
  work: Work;
}

export interface Reco {
  id: number;
  reason: string;
  work_id: number | null;
  tmdb_type?: 'movie' | 'tv';
  title: string;
  year?: number | null;
  is_anime?: number;
  poster_url?: string;
  rating_source: RatingSource;
  primary_rating?: number | null;
  douban_id?: string | null;
  douban_url?: string | null;
  bangumi_id?: number | null;
}

export interface User {
  id: number;
  display_name: string;
  avatar?: string | null;
}

// GET /api/settings（密钥脱敏）；含若干 *_source 字段，用索引签名兜底
export interface ApiSettings {
  llm_base_url: string;
  llm_model: string;
  bangumi_ua: string;
  llm_api_key_set: boolean;
  tmdb_token_set: boolean;
  tmdb_key_set: boolean;
  llm_ready: boolean;
  tmdb_ready: boolean;
  igdb_ready: boolean;
  steam_ready: boolean;
  [k: string]: string | boolean | undefined;
}

export interface GameWork {
  id: number;
  igdb_id?: number | null;
  steam_appid?: number | null;
  catalog_source: 'igdb' | 'steam' | 'manual';
  content_type: 'game' | 'dlc';
  parent_igdb_id?: number | null;
  parent_steam_appid?: number | null;
  parent_title?: string | null;
  title: string;
  original_title?: string | null;
  release_date?: string | null;
  release_year?: number | null;
  release_state: 'released' | 'unreleased' | 'early_access';
  is_free: number;
  short_description?: string | null;
  about_game?: string | null;
  developers?: string | null;
  publishers?: string | null;
  genres?: string | null;
  platforms?: string | null;
  play_modes?: string | null;
  supports_together: number;
  cover_url?: string | null;
  header_url?: string | null;
  initial_price?: number | null;
  current_price?: number | null;
  discount_percent?: number;
  price_formatted?: string | null;
  discount_end_date?: string | null;
  review_desc?: string | null;
  review_total?: number | null;
  review_percent?: number | null;
  recent_review_desc?: string | null;
  recent_review_total?: number | null;
  recent_review_percent?: number | null;
  catalog_rating?: number | null;
  catalog_rating_count?: number | null;
  critic_rating?: number | null;
  critic_rating_count?: number | null;
  igdb_url?: string | null;
  external_links?: string | null;
  store_url?: string | null;
  source_url?: string | null;
  platform_releases?: Array<Record<string, unknown>>;
  all_marks?: GameMark[];
  my_mark?: GameMark | null;
  sessions?: GameSession[];
  plan?: GamePlanItem | null;
}

export interface GameMark {
  id: number;
  user_id: number;
  work_id: number;
  status: 'played';
  rating?: number | null;
  comment?: string | null;
  marked_at: number;
  work: GameWork;
}

export interface GameSession {
  id: number;
  work_id: number;
  played_at?: number | null;
  completed_at?: number | null;
  rating_a?: number | null;
  rating_b?: number | null;
  review_a?: string | null;
  review_b?: string | null;
  joint_note?: string | null;
  work: GameWork;
}

export interface GamePlanItem {
  id: number;
  work_id: number;
  added_by: number;
  note?: string | null;
  priority: number;
  status: 'pending' | 'playing' | 'done' | 'dropped';
  work: GameWork;
}

export interface GameReco extends GameWork {
  reason: string;
  confidence_note?: string | null;
  work_id: number;
  poster_url?: string | null;
}
