CREATE TABLE `friend_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `friend_events_actor_idx` ON `friend_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `friend_events_target_idx` ON `friend_events` (`target_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `money_requests` ADD `last_reminded_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `activity_seen_at` integer;--> statement-breakpoint
UPDATE `users` SET `activity_seen_at` = CAST(strftime('%s','now') AS integer) * 1000;
