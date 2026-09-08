-- Fase 1+3: Telegram por cuenta (workspace activo), fechas de recordatorio en nodos,
-- notificaciones in-app y suscripciones Web Push.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_telegram_chats` (
	`telegram_chat_id` text NOT NULL,
	`telegram_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active_workspace_id` text,
	`last_activity_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`telegram_chat_id`, `telegram_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Legacy: workspace_id era la vinculación única por chat → pasa a active_workspace_id
-- (el usuario podrá re-vincular el chat con /usar <slug> sin desvincular la cuenta).
INSERT INTO `__new_telegram_chats`("telegram_chat_id", "telegram_user_id", "user_id", "active_workspace_id", "last_activity_at", "created_at")
SELECT "telegram_chat_id", "telegram_user_id", "user_id", "workspace_id", "created_at", "created_at" FROM `telegram_chats`;
--> statement-breakpoint
DROP TABLE `telegram_chats`;--> statement-breakpoint
ALTER TABLE `__new_telegram_chats` RENAME TO `telegram_chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_telegram_chat` ON `telegram_chats` (`telegram_chat_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_active_workspace` ON `telegram_chats` (`active_workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_user` ON `telegram_chats` (`user_id`);--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `due_date` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `reminder_offset_min` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `notified_at` integer;--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`node_id` text,
	`kind` text DEFAULT 'system' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `web_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`keys_auth` text NOT NULL,
	`keys_p256dh` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webpush_endpoint` ON `web_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_webpush_user` ON `web_push_subscriptions` (`user_id`);