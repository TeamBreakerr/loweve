// 后端 API 返回的数据形状（前端用到的字段）
export type RatingSource = 'douban' | 'bangumi' | 'tmdb';

export interface Work {
  id: number;
  tmdb_id: number;
  tmdb_type: 'movie' | 'tv';
  title: string;
  original_title?: string | null;
  year?: number | null;
  is_anime?: number;
  genres?: string | null;
  runtime?: number | null;
  overview?: string | null;
  primary_poster_url?: string;
  primary_rating?: number | null;
  rating_source: RatingSource;
  douban_id?: string | null;
  douban_url?: string | null;
  bangumi_id?: number | null;
  all_marks: Mark[];
  sessions: Session[];
  plan?: PlanItem | null;
  my_mark?: Mark | null;
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
  [k: string]: string | boolean | undefined;
}
