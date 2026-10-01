-- Story 3.6: the hospital name printed on queue slips (2–80 characters).
-- SQLite can't add a CHECK to an existing table, so the single row is copied
-- into a rebuilt table; the new column takes its default.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_opd_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`prenatal_target` integer NOT NULL,
	`no_show_threshold` integer NOT NULL,
	`pre_close_warning_minutes` integer NOT NULL,
	`hospital_name` text DEFAULT 'Hospital OPD' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "opd_settings_single_row_check" CHECK("__new_opd_settings"."id" = 1),
	CONSTRAINT "opd_settings_hospital_name_check" CHECK(length(trim("__new_opd_settings"."hospital_name")) between 2 and 80),
	CONSTRAINT "opd_settings_prenatal_target_check" CHECK("__new_opd_settings"."prenatal_target" between 1 and 20),
	CONSTRAINT "opd_settings_no_show_threshold_check" CHECK("__new_opd_settings"."no_show_threshold" between 1 and 10),
	CONSTRAINT "opd_settings_pre_close_warning_check" CHECK("__new_opd_settings"."pre_close_warning_minutes" between 0 and 120)
);
--> statement-breakpoint
INSERT INTO `__new_opd_settings`("id", "prenatal_target", "no_show_threshold", "pre_close_warning_minutes", "updated_at") SELECT "id", "prenatal_target", "no_show_threshold", "pre_close_warning_minutes", "updated_at" FROM `opd_settings`;--> statement-breakpoint
DROP TABLE `opd_settings`;--> statement-breakpoint
ALTER TABLE `__new_opd_settings` RENAME TO `opd_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
