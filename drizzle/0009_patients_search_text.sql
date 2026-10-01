ALTER TABLE `patients` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill: the same forms as patientSearchText() in src/server/patients/repo.ts.
-- unicode_lower is registered on every app connection (src/server/db/client.ts).
UPDATE `patients` SET `search_text` = unicode_lower(
  trim(`first_name`) || ' ' || trim(`last_name`) || char(10) ||
  trim(`first_name`) || coalesce(' ' || nullif(trim(`middle_name`), ''), '') || ' ' || trim(`last_name`) || coalesce(' ' || nullif(trim(`suffix`), ''), '') || char(10) ||
  trim(`last_name`) || ', ' || trim(`first_name`) || coalesce(' ' || nullif(trim(`middle_name`), ''), '') || coalesce(' ' || nullif(trim(`suffix`), ''), '')
);