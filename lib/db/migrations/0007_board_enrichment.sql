-- F0 Tablero enriquecido: prioridad/esfuerzo/responsable + columnas dinámicas + orden.
-- - nodes.priority: urgent|high|medium|low, NULL sin default (validado en servicio, task-only).
-- - nodes.effort: int 0..100 NULL (validado en servicio, task-only).
-- - nodes.assignee_id: FK users SET NULL (responsable, task-only).
-- - board_columns: columnas por workspace, position con gaps, UNIQUE NOCASE manual (no DB).
-- - nodes.board_column_id: FK board_columns SET NULL + board_order REAL NOT NULL DEFAULT 0.
ALTER TABLE `nodes` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `effort` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `assignee_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `nodes` ADD `board_column_id` text REFERENCES `board_columns`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `nodes` ADD `board_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `board_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_board_columns_workspace` ON `board_columns` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_board_columns_workspace_position` ON `board_columns` (`workspace_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_nodes_board_column` ON `nodes` (`board_column_id`);--> statement-breakpoint
CREATE INDEX `idx_nodes_workspace_board` ON `nodes` (`workspace_id`,`board_column_id`,`board_order`);--> statement-breakpoint
CREATE INDEX `idx_nodes_assignee` ON `nodes` (`assignee_id`);
