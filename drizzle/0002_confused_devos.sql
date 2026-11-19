CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_address` text NOT NULL,
	`recipient_user_id` text,
	`to_address` text NOT NULL,
	`amount_raw` text NOT NULL,
	`note` text,
	`est_fee_raw` text NOT NULL,
	`actual_fee_raw` text,
	`status` text DEFAULT 'created' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`quote_id` text NOT NULL,
	`transaction_id` text,
	`user_op_hash` text,
	`tx_hash` text,
	`provider_status` text,
	`error` text,
	`start_block` integer NOT NULL,
	`scan_cursor` integer,
	`created_at` integer NOT NULL,
	`submitted_at` integer,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idem_uq` ON `payments` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_one_open_per_wallet` ON `payments` (`from_address`) WHERE "payments"."status" in ('created', 'submitted');--> statement-breakpoint
CREATE INDEX `payments_tx_idx` ON `payments` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `payments_user_idx` ON `payments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`op` text NOT NULL,
	`recipient_key` text NOT NULL,
	`amount_raw` text NOT NULL,
	`est_fee_raw` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quotes_user_idx` ON `quotes` (`user_id`,`created_at`);