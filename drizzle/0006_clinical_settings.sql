CREATE TABLE `clinical_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`days` text NOT NULL,
	`sort_order` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "clinical_schedules_days_check" CHECK(json_valid("clinical_schedules"."days") and json_type("clinical_schedules"."days") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_schedules_code_unique` ON `clinical_schedules` (`code`);--> statement-breakpoint
CREATE TABLE `opd_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`prenatal_target` integer NOT NULL,
	`no_show_threshold` integer NOT NULL,
	`pre_close_warning_minutes` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "opd_settings_single_row_check" CHECK("opd_settings"."id" = 1),
	CONSTRAINT "opd_settings_prenatal_target_check" CHECK("opd_settings"."prenatal_target" between 1 and 20),
	CONSTRAINT "opd_settings_no_show_threshold_check" CHECK("opd_settings"."no_show_threshold" between 1 and 10),
	CONSTRAINT "opd_settings_pre_close_warning_check" CHECK("opd_settings"."pre_close_warning_minutes" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE `priority_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`legal_basis` text NOT NULL,
	`legally_required` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `priority_categories_code_unique` ON `priority_categories` (`code`);--> statement-breakpoint
CREATE TABLE `urgency_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_er` integer DEFAULT false NOT NULL,
	`rank` integer,
	`deactivated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "urgency_levels_rank_check" CHECK(("urgency_levels"."is_er" = 1 and "urgency_levels"."rank" is null) or ("urgency_levels"."is_er" = 0 and "urgency_levels"."rank" is not null and "urgency_levels"."rank" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `urgency_levels_active_rank_unique` ON `urgency_levels` (`rank`) WHERE "urgency_levels"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `urgency_levels_active_name_unique` ON `urgency_levels` ("name" collate nocase) WHERE "urgency_levels"."deactivated_at" is null;--> statement-breakpoint
-- Seed: the PRD's clinical defaults (FR-24). Admins edit them at /admin/settings.
INSERT INTO `urgency_levels` (`id`, `name`, `is_er`, `rank`, `deactivated_at`, `created_at`, `updated_at`) VALUES
	('5a0e1c3d-7b9f-4e21-8c4a-0d6f8b2e1a51', 'Emergency', 1, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('6b1f2d4e-8c0a-4f32-9d5b-1e7a9c3f2b62', 'Urgent', 0, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('7c2a3e5f-9d1b-4a43-8e6c-2f8b0d4a3c73', 'Routine', 0, 2, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
INSERT INTO `priority_categories` (`id`, `code`, `name`, `legal_basis`, `legally_required`, `enabled`, `sort_order`, `updated_at`) VALUES
	('8d3b4f6a-0e2c-4b54-9f7d-3a9c1e5b4d84', 'senior_citizen', 'Senior Citizen', 'RA 9994', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('9e4c5a7b-1f3d-4c65-8a8e-4b0d2f6c5e95', 'pwd', 'PWD', 'RA 10754', 1, 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('af5d6b8c-2a4e-4d76-9b9f-5c1e3a7d6fa6', 'pregnant', 'Pregnant', 'Hospital policy', 0, 1, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
INSERT INTO `clinical_schedules` (`id`, `code`, `name`, `days`, `sort_order`, `updated_at`) VALUES
	('b06e7c9d-3b5f-4e87-8c0a-6d2f4b8e7ab7', 'abc_new', 'New patient', '[0,3,7]', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('c17f8dae-4c6a-4f98-9d1b-7e3a5c9f8bc8', 'abc_previously_immunized', 'Previously immunized', '[0,3]', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
INSERT INTO `opd_settings` (`id`, `prenatal_target`, `no_show_threshold`, `pre_close_warning_minutes`, `updated_at`) VALUES
	(1, 8, 3, 30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));