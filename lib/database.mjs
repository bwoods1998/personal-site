import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Local development adapter; hosted storage lives in the Cloudflare Durable Object.
export async function openDatabase({ filename }) {
  if (filename !== ':memory:') await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(filename, { timeout: 5000 });
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  let tail = Promise.resolve();
  return {
    kind: 'sqlite',
    transaction(callback, readOnly = false) {
      // Do not interleave async callers on the local connection.
      const pending = tail.then(async () => {
        sqlite.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
        try {
          const query = async (sql, params = []) => sqlite.prepare(sql).all(...params);
          const result = await callback(query);
          sqlite.exec('COMMIT');
          return result;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      tail = pending.catch(() => {});
      return pending;
    },
    async close() { await tail; sqlite.close(); },
  };
}
