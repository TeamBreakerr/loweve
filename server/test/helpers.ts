// server/test/helpers.js
import { openDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

export function makeTestDb({ userA = 'TestA', userB = 'TestB' } = {}): any {
  const db = openDb(':memory:');
  migrate(db, { userA, userB });
  return db;
}

// 测试 stub：模拟 tmdb client 接口。impl 任意子集，未实现的方法回 throw 提示。
export function makeFakeTmdb(impl: any = {}) {
  return {
    isConfigured: impl.isConfigured ?? (() => true),
    search:        impl.search        ?? (async () => { throw new Error('fake tmdb.search not stubbed'); }),
    movieDetail:   impl.movieDetail   ?? (async () => { throw new Error('fake tmdb.movieDetail not stubbed'); }),
    tvDetail:      impl.tvDetail      ?? (async () => { throw new Error('fake tmdb.tvDetail not stubbed'); }),
    tvSeasonDetail: impl.tvSeasonDetail ?? (async () => { throw new Error('fake tmdb.tvSeasonDetail not stubbed'); }),
  };
}

// 测试 stub：模拟 bangumi client。impl 任意子集。
export function makeFakeBangumi(impl: any = {}) {
  return {
    isConfigured: impl.isConfigured ?? (() => true),
    searchAnime:  impl.searchAnime  ?? (async () => []),
    subjectDetail: impl.subjectDetail ?? (async () => { throw new Error('fake bangumi.subjectDetail not stubbed'); }),
    hotReviews: impl.hotReviews ?? (async () => []),
  };
}

export function makeFakeDouban(impl: any = {}) {
  return {
    match: impl.match ?? (async () => null),
    hotReviews: impl.hotReviews ?? (async () => []),
  };
}

export function makeFakeLlm(impl: any = {}) {
  return {
    isConfigured: impl.isConfigured ?? (() => true),
    chat: impl.chat ?? (async () => '[]'),
  };
}

export function makeFakeSteam(impl: any = {}) {
  return {
    isConfigured: impl.isConfigured ?? (() => true),
    search: impl.search ?? (async () => ({ results: [] })),
    searchCandidates: impl.searchCandidates ?? impl.search ?? (async () => ({ results: [] })),
    gameDetail: impl.gameDetail ?? (async () => { throw new Error('fake steam.gameDetail not stubbed'); }),
    hotReviews: impl.hotReviews ?? (async () => []),
  };
}

export function makeFakeIgdb(impl: any = {}) {
  return {
    isConfigured: impl.isConfigured ?? (() => true),
    search: impl.search ?? (async () => ({ results: [] })),
    gameDetail: impl.gameDetail ?? (async () => { throw new Error('fake igdb.gameDetail not stubbed'); }),
  };
}

export function makeFakeWikidata(impl: any = {}) {
  return {
    searchGameAliases: impl.searchGameAliases ?? (async () => []),
  };
}
