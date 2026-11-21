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
  activitySeenAt: integer('activity_seen_at'), // when the user last opened Activity (unread badges); null = never
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

// Server-side quotes: bound to user, operation, recipient and exact amount. Short-lived, single use.
export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    op: text('op', { enum: ['send', 'withdraw'] }).notNull(),
    recipientKey: text('recipient_key').notNull(), // friend user ID (send) or lowercase address (withdraw)
    amountRaw: text('amount_raw').notNull(),
    estFeeRaw: text('est_fee_raw').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (t) => [index('quotes_user_idx').on(t.userId, t.createdAt)],
);

// Outgoing transfer intents (sends and withdrawals). Persisted BEFORE the provider call. The chain is the
// source of truth for the outcome; provider fields are hints.
export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['send', 'withdrawal'] }).notNull(),
    fromAddress: text('from_address').notNull(),
    recipientUserId: text('recipient_user_id'), // null for withdrawals
    toAddress: text('to_address').notNull(),
    amountRaw: text('amount_raw').notNull(), // what the recipient receives
    note: text('note'),
    estFeeRaw: text('est_fee_raw').notNull(),
    actualFeeRaw: text('actual_fee_raw'), // from the receipt: the sender's other USDC transfers in the tx
    status: text('status', { enum: ['created', 'submitted', 'confirmed', 'failed'] }).notNull().default('created'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    quoteId: text('quote_id').notNull(),
    transactionId: text('transaction_id'),
    userOpHash: text('user_op_hash'),
    txHash: text('tx_hash'),
    providerStatus: text('provider_status'), // hint only
    error: text('error'),
    startBlock: integer('start_block').notNull(), // head when the intent was created; log searches start here
    scanCursor: integer('scan_cursor'), // last block searched for this intent's outcome
    createdAt: integer('created_at').notNull(),
    submittedAt: integer('submitted_at'),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    uniqueIndex('payments_idem_uq').on(t.userId, t.idempotencyKey),
    // One unresolved intent per sender wallet, sends and withdrawals together.
    uniqueIndex('payments_one_open_per_wallet').on(t.fromAddress).where(sql`${t.status} in ('created', 'submitted')`),
    index('payments_tx_idx').on(t.txHash),
    index('payments_user_idx').on(t.userId, t.createdAt),
  ],
);

// A request from `requesterId` asking `payerId` (an accepted friend) to pay `amountRaw`. Paying one uses the normal
// quote and send path; `paymentId` links the send that is paying it. "Expired", "paying" and "paid" are derived
// from expiresAt and the linked payment's status, so no worker has to touch this table.
export const moneyRequests = sqliteTable(
  'money_requests',
  {
    id: text('id').primaryKey(),
    requesterId: text('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    payerId: text('payer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amountRaw: text('amount_raw').notNull(),
    note: text('note'),
    status: text('status', { enum: ['pending', 'declined', 'cancelled'] }).notNull().default('pending'),
    paymentId: text('payment_id'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    respondedAt: integer('responded_at'),
    lastRemindedAt: integer('last_reminded_at'),
  },
  (t) => [
    index('money_requests_payer_idx').on(t.payerId, t.createdAt),
    index('money_requests_requester_idx').on(t.requesterId, t.createdAt),
    check('money_requests_distinct', sql`${t.requesterId} <> ${t.payerId}`),
  ],
);

// A small history of friendship changes that would otherwise leave no trace (a decline or cancel deletes the pair row).
// Both people involved can see an event: the actor did `type` to the target.
export const friendEvents = sqliteTable(
  'friend_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['accepted', 'declined', 'cancelled', 'removed'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('friend_events_actor_idx').on(t.actorId, t.createdAt), index('friend_events_target_idx').on(t.targetId, t.createdAt)],
);
