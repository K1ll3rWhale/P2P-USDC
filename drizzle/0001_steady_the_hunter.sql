CREATE TABLE `chain_cursors` (
	`key` text PRIMARY KEY NOT NULL,
	`last_block` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_low` text NOT NULL,
	`user_high` text NOT NULL,
	`requester_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`user_low`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_high`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friendships_order" CHECK("friendships"."user_low" < "friendships"."user_high"),
	CONSTRAINT "friendships_requester" CHECK("friendships"."requester_id" in ("friendships"."user_low", "friendships"."user_high"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_pair_uq` ON `friendships` (`user_low`,`user_high`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` integer NOT NULL,
	`token` text NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`block_timestamp` integer,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`user_id` text NOT NULL,
	`amount_raw` text NOT NULL,
	`status` text DEFAULT 'observed' NOT NULL,
	`kind` text DEFAULT 'deposit' NOT NULL,
	`claimed_intent_id` text,
	`observed_at` integer NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_log_uq` ON `transfers` (`chain_id`,`token`,`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `transfers_user_idx` ON `transfers` (`user_id`,`block_number`);--> statement-breakpoint
CREATE INDEX `transfers_status_idx` ON `transfers` (`status`);--> statement-breakpoint
CREATE INDEX `transfers_tx_idx` ON `transfers` (`tx_hash`);