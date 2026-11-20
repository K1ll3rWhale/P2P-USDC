CREATE TABLE `money_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`payer_id` text NOT NULL,
	`amount_raw` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "money_requests_distinct" CHECK("money_requests"."requester_id" <> "money_requests"."payer_id")
);
--> statement-breakpoint
CREATE INDEX `money_requests_payer_idx` ON `money_requests` (`payer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `money_requests_requester_idx` ON `money_requests` (`requester_id`,`created_at`);