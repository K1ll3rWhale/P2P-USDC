import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const path = process.env.DATABASE_PATH?.trim() || 'data/app.db';
const g = globalThis as unknown as { __sqlite?: Database.Database };

function open() {
  mkdirSync(dirname(path), { recursive: true });
  const s = new Database(path);
  s.pragma('journal_mode = WAL');
  s.pragma('foreign_keys = ON');
  s.pragma('busy_timeout = 5000'); // the web app and the worker share this file
  return s;
}

const sqlite = (g.__sqlite ??= open());
export const db = drizzle(sqlite, { schema });
export { schema };
