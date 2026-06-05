// server/src/db/index.js
import Database from 'better-sqlite3';

/**
 * 打开 SQLite 数据库连接。
 * @param {string} file - 文件路径，或 ':memory:' 表示内存库
 * @returns {Database.Database}
 */
export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
