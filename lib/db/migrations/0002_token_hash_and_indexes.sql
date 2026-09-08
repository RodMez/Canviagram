ALTER TABLE `email_verification_tokens` RENAME COLUMN "token" TO "token_hash";--> statement-breakpoint
-- Legacy tokens quedaron en claro (semántica pasa a hash sha256): invalidar filas previas.
DELETE FROM `email_verification_tokens`;--> statement-breakpoint
ALTER TABLE `invitations` RENAME COLUMN "token" TO "token_hash";--> statement-breakpoint
DELETE FROM `invitations`;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` RENAME COLUMN "token" TO "token_hash";--> statement-breakpoint
DELETE FROM `password_reset_tokens`;--> statement-breakpoint
DROP INDEX `email_verification_tokens_token_unique`;--> statement-breakpoint
DROP INDEX `idx_email_verify_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_verify_token` ON `email_verification_tokens` (`token_hash`);--> statement-breakpoint
DROP INDEX `invitations_token_unique`;--> statement-breakpoint
DROP INDEX `idx_invitations_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invitations_token` ON `invitations` (`token_hash`);--> statement-breakpoint
DROP INDEX `password_reset_tokens_token_unique`;--> statement-breakpoint
DROP INDEX `idx_pwd_reset_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pwd_reset_token` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "owner_id", "name", "slug", "created_at", "updated_at") SELECT "id", "owner_id", "name", "slug", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_workspaces_owner` ON `workspaces` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspaces_slug` ON `workspaces` (`slug`);--> statement-breakpoint
DROP INDEX `sessions_token_hash_unique`;--> statement-breakpoint
DROP INDEX `users_email_unique`;