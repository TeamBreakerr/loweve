// server/test/season.test.js
import assert from 'node:assert/strict';
import { cnNumber, seasonLabel } from '../src/tmdb/season.js';

describe('cnNumber / seasonLabel', () => {
  it('1–99 中文数字', () => {
    assert.equal(cnNumber(1), '一');
    assert.equal(cnNumber(4), '四');
    assert.equal(cnNumber(9), '九');
    assert.equal(cnNumber(10), '十');
    assert.equal(cnNumber(11), '十一');
    assert.equal(cnNumber(20), '二十');
    assert.equal(cnNumber(24), '二十四');
    assert.equal(cnNumber(99), '九十九');
  });
  it('seasonLabel 拼「第N季」', () => {
    assert.equal(seasonLabel(1), '第一季');
    assert.equal(seasonLabel(4), '第四季');
    assert.equal(seasonLabel(13), '第十三季');
  });
});
