CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`ai_model` text NOT NULL,
	`ai_model_fallback` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;