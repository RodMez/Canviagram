CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_key` text NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_workspace_chat` ON `chat_messages` (`workspace_id`,`chat_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_chat_key` ON `chat_messages` (`chat_key`);