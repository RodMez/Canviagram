-- F5.1: un workspace = un proyecto. El contenido del ex nodo-hub `project`
-- vive ahora en workspaces.description; nodes.type es TEXT libre así que no
-- requiere ALTER en `nodes` (el enum vive solo en Zod/TS).
-- Sin backfill: DB solo con datos de prueba (decisión 2026-09-11).
ALTER TABLE `workspaces` ADD `description` text;
