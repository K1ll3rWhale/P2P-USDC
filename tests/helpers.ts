// Test helpers. Import this FIRST in each test file: it points the app at a fresh temporary SQLite database.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'p2p-test-')), 'test.db');

const { db } = await import('../lib/db');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const schema = await import('../lib/db/schema');
migrate(db, { migrationsFolder: 'drizzle' });

export { db, schema };

export function addUser(name: string, address?: string, status: 'active' | 'pending' = 'active') {
  const id = `id-${name}`;
  db.insert(schema.users)
    .values({ id, email: `${name}@x.test`, emailNorm: `${name}@x.test`, username: name, usernameNorm: name.toLowerCase(), passwordHash: 'x', status, createdAt: Date.now() })
    .run();
  if (address) {
    db.insert(schema.wallets)
      .values({ id: `w-${name}`, userId: id, provider: 'test', providerWalletId: `pw-${name}`, address: address.toLowerCase(), chainId: 84532, createdAt: Date.now() })
      .run();
  }
  return id;
}
