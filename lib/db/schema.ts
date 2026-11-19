import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Timestamps are Unix milliseconds. Normalized columns hold lowercase values and carry the unique indexes,
// which makes email and username uniqueness case-insensitive.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  emailNorm: text('email_norm').notNull().unique(),
  username: text('username').notNull(),
  usernameNorm: text('username_norm').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  status: text('status', { enum: ['pending', 'active'] }).notNull().default('pending'),
  provisioningError: text('provisioning_error'),
  provisioningStartedAt: integer('provisioning_started_at'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const wallets = sqliteTable('wallets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerWalletId: text('provider_wallet_id').notNull(),
  address: text('address').notNull().unique(), // lowercase
  chainId: integer('chain_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('rate_limits_key_idx').on(t.key, t.createdAt)],
);
