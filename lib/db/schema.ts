import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// Observed on-chain USDC transfers into app wallets. One row per log. A later send can "claim" its own
// incoming transfer by known tx hash: set `kind` and `claimedIntentId` on the existing row (never insert twice).
export const transfers = sqliteTable(
  'transfers',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    token: text('token').notNull(), // lowercase contract address
    txHash: text('tx_hash').notNull(), // lowercase
    logIndex: integer('log_index').notNull(),
    blockNumber: integer('block_number').notNull(),
    blockHash: text('block_hash').notNull(),
    blockTimestamp: integer('block_timestamp'), // seconds
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), // recipient
    amountRaw: text('amount_raw').notNull(), // integer base units as text
    status: text('status', { enum: ['observed', 'confirmed', 'dropped'] }).notNull().default('observed'),
    kind: text('kind').notNull().default('deposit'),
    claimedIntentId: text('claimed_intent_id'),
    observedAt: integer('observed_at').notNull(),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => [
    uniqueIndex('transfers_log_uq').on(t.chainId, t.token, t.txHash, t.logIndex),
    index('transfers_user_idx').on(t.userId, t.blockNumber),
    index('transfers_status_idx').on(t.status),
    index('transfers_tx_idx').on(t.txHash),
  ],
);

export const chainCursors = sqliteTable('chain_cursors', {
  key: text('key').primaryKey(),
  lastBlock: integer('last_block').notNull(), // last block fully scanned
  updatedAt: integer('updated_at').notNull(),
});

// One row per unordered pair: userLow < userHigh (string order). Decline and cancel delete the row.
export const friendships = sqliteTable(
  'friendships',
  {
    id: text('id').primaryKey(),
    userLow: text('user_low').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userHigh: text('user_high').notNull().references(() => users.id, { onDelete: 'cascade' }),
    requesterId: text('requester_id').notNull(),
    status: text('status', { enum: ['pending', 'accepted'] }).notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    respondedAt: integer('responded_at'),
  },
  (t) => [
    uniqueIndex('friendships_pair_uq').on(t.userLow, t.userHigh),
    check('friendships_order', sql`${t.userLow} < ${t.userHigh}`),
    check('friendships_requester', sql`${t.requesterId} in (${t.userLow}, ${t.userHigh})`),
  ],
);
