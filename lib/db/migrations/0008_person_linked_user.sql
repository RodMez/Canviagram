-- Nodo persona vinculado a usuario del workspace (linked_user_id, solo type==='person').
-- Null = nombre libre sin cuenta (comportamiento actual con title se conserva).
ALTER TABLE `nodes` ADD `linked_user_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_nodes_linked_user` ON `nodes` (`linked_user_id`);
