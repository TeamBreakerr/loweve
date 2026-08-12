import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestDb } from './helpers.js';
import { effectiveConfig, readForApi, updateSettings } from '../src/settings.js';
import { createApp } from '../src/app.js';
import { createLlmClient } from '../src/llm/client.js';

describe('settings 运行时配置', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('updateSettings 写覆盖，effectiveConfig 优先用 DB', () => {
    updateSettings(db, { llm_base_url: 'https://x/v1', llm_api_key: 'sk-1', llm_model: 'm' });
    const e = effectiveConfig(db);
    assert.equal(e.llmBaseUrl, 'https://x/v1');
    assert.equal(e.llmApiKey, 'sk-1');
    assert.equal(e.llmModel, 'm');
  });

  it('readForApi 脱敏：密钥只回 *_set、非密钥明文、附 ready', () => {
    updateSettings(db, {
      llm_base_url: 'https://x/v1', llm_api_key: 'sk-1', llm_model: 'm',
      igdb_client_id: 'client-id', igdb_client_secret: 'client-secret',
    });
    const out = readForApi(db);
    assert.equal(out.llm_base_url, 'https://x/v1');
    assert.equal(out.llm_model, 'm');
    assert.equal(out.llm_api_key_set, true);
    assert.equal(out.llm_api_key, undefined);   // 密钥不回明文
    assert.equal(out.llm_ready, true);
    assert.equal(out.igdb_client_id, 'client-id');
    assert.equal(out.igdb_client_secret_set, true);
    assert.equal(out.igdb_client_secret, undefined);
    assert.equal(out.igdb_ready, true);
  });

  it('空串清除覆盖 → 回退 env 默认', () => {
    updateSettings(db, { llm_model: 'm' });
    assert.equal(effectiveConfig(db).llmModel, 'm');
    updateSettings(db, { llm_model: '' });
    assert.equal(effectiveConfig(db).llmModel, '');
  });

  it('白名单外的 key 被忽略', () => {
    updateSettings(db, { evil: 'x', llm_model: 'm' });
    assert.equal(effectiveConfig(db).llmModel, 'm');
  });

  it('GET 脱敏 / PUT 需身份', async () => {
    const app = createApp({ db });
    assert.equal((await request(app).put('/api/settings').send({ llm_model: 'm' })).status, 401);
    const put = await request(app).put('/api/settings').set('Cookie', 'loweve_user_id=1')
      .send({ llm_base_url: 'https://x/v1', llm_api_key: 'sk', llm_model: 'm' });
    assert.equal(put.status, 200);
    assert.equal(put.body.llm_api_key_set, true);
    const get = await request(app).get('/api/settings');
    assert.equal(get.body.llm_base_url, 'https://x/v1');
    assert.equal(get.body.llm_api_key, undefined);
    assert.equal(get.body.llm_ready, true);
  });

  it('GET /api/settings/models 返回当前 AI 端点探测到的可选模型', async () => {
    const app = createApp({ db, llm: { listModels: async () => ['deepseek-v4-flash', 'gpt-5.6'] } });
    const res = await request(app).get('/api/settings/models').set('Cookie', 'loweve_user_id=1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.models, ['deepseek-v4-flash', 'gpt-5.6']);
  });

  it('createLlmClient(resolve) 运行时即时反映配置变化（不用重建）', () => {
    let cfg = { baseUrl: '', apiKey: '', model: '' };
    const llm = createLlmClient({ resolve: () => cfg });
    assert.equal(llm.isConfigured(), false);
    cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
    assert.equal(llm.isConfigured(), true);
  });
});
