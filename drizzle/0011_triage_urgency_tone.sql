-- Adds the Urgency badge tone to the triage snapshot (AD-6). Existing rows are
-- backfilled with urgencyTone() (src/lib/triage.ts) against today's active levels.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_triage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`chief_complaint` text NOT NULL,
	`temperature_c` real NOT NULL,
	`bp_systolic` integer NOT NULL,
	`bp_diastolic` integer NOT NULL,
	`pulse` integer NOT NULL,
	`respiratory_rate` integer NOT NULL,
	`spo2` integer,
	`weight_kg` real,
	`abnormal_fields` text DEFAULT '[]' NOT NULL,
	`urgency_level_id` text NOT NULL,
	`urgency_name` text NOT NULL,
	`urgency_rank` integer,
	`urgency_is_er` integer NOT NULL,
	`urgency_tone` text DEFAULT 'routine' NOT NULL,
	`sort_group` integer,
	`priority_category` text,
	`priority_id_status` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`urgency_level_id`) REFERENCES `urgency_levels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "triage_records_complaint_check" CHECK(length(trim("__new_triage_records"."chief_complaint")) between 1 and 500),
	CONSTRAINT "triage_records_abnormal_fields_check" CHECK(json_valid("__new_triage_records"."abnormal_fields") and json_type("__new_triage_records"."abnormal_fields") = 'array'),
	CONSTRAINT "triage_records_snapshot_check" CHECK(("__new_triage_records"."urgency_is_er" = 1 and "__new_triage_records"."urgency_rank" is null and "__new_triage_records"."sort_group" is null) or ("__new_triage_records"."urgency_is_er" = 0 and "__new_triage_records"."urgency_rank" is not null and "__new_triage_records"."sort_group" in (1, 2, 3))),
	CONSTRAINT "triage_records_urgency_tone_check" CHECK("__new_triage_records"."urgency_tone" in ('urgent', 'abnormal', 'routine')),
	CONSTRAINT "triage_records_priority_id_status_check" CHECK("__new_triage_records"."priority_id_status" is null or "__new_triage_records"."priority_id_status" in ('on_file', 'entered', 'not_presented'))
);
--> statement-breakpoint
INSERT INTO `__new_triage_records`("id", "visit_id", "patient_id", "chief_complaint", "temperature_c", "bp_systolic", "bp_diastolic", "pulse", "respiratory_rate", "spo2", "weight_kg", "abnormal_fields", "urgency_level_id", "urgency_name", "urgency_rank", "urgency_is_er", "urgency_tone", "sort_group", "priority_category", "priority_id_status", "recorded_by", "recorded_at") SELECT "id", "visit_id", "patient_id", "chief_complaint", "temperature_c", "bp_systolic", "bp_diastolic", "pulse", "respiratory_rate", "spo2", "weight_kg", "abnormal_fields", "urgency_level_id", "urgency_name", "urgency_rank", "urgency_is_er", CASE WHEN "urgency_is_er" = 1 OR "urgency_rank" <= 1 THEN 'urgent' WHEN "urgency_rank" >= coalesce((SELECT max("rank") FROM "urgency_levels" WHERE "is_er" = 0 AND "deactivated_at" IS NULL), "urgency_rank") THEN 'routine' ELSE 'abnormal' END, "sort_group", "priority_category", "priority_id_status", "recorded_by", "recorded_at" FROM `triage_records`;--> statement-breakpoint
DROP TABLE `triage_records`;--> statement-breakpoint
ALTER TABLE `__new_triage_records` RENAME TO `triage_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `triage_records_visit_unique` ON `triage_records` (`visit_id`);--> statement-breakpoint
CREATE INDEX `triage_records_patient_idx` ON `triage_records` (`patient_id`);