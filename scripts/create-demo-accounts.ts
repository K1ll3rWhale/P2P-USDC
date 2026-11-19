// Creates the alice and bob demo accounts through the normal signup path (lib/accounts.signupUser).
// Testnet demo accounts only. Password comes from DEMO_PASSWORD, with a documented demo default.
import '../lib/load-env';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { signupUser } from '../lib/accounts';
import { db } from '../lib/db';
import { users, wallets } from '../lib/db/schema';
import { provisionWallet } from '../lib/provisioning';

migrate(db, { migrationsFolder: 'drizzle' });
const password = process.env.DEMO_PASSWORD?.trim() || 'demo-password-123';

for (const name of ['alice', 'bob']) {
  const existing = db.select().from(users).where(eq(users.usernameNorm, name)).get();
  let userId = existing?.id;
  if (!existing) {
    const r = await signupUser({ email: `${name}@example.com`, username: name, password }, 'script');
    if (!r.ok) {
      console.error(`${name}: signup failed: ${r.error}`);
      process.exitCode = 1;
      continue;
    }
    userId = r.userId;
    if (!r.walletReady) console.error(`${name}: wallet pending: ${r.walletError}`);
  } else if (existing.status !== 'active') {
    await provisionWallet(existing.id); // recover a pending account
  }
  const user = db.select().from(users).where(eq(users.id, userId!)).get();
  const wallet = db.select().from(wallets).where(eq(wallets.userId, userId!)).get();
  console.log(`${name}: ${existing ? 'existing' : 'created'}, status ${user?.status}, address ${wallet?.address ?? 'none'}`);
}
