CREATE TABLE `triage_records` (
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
	`sort_group` integer,
	`priority_category` text,
	`priority_id_status` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`urgency_level_id`) REFERENCES `urgency_levels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "triage_records_complaint_check" CHECK(length(trim("triage_records"."chief_complaint")) between 1 and 500),
	CONSTRAINT "triage_records_abnormal_fields_check" CHECK(json_valid("triage_records"."abnormal_fields") and json_type("triage_records"."abnormal_fields") = 'array'),
	CONSTRAINT "triage_records_snapshot_check" CHECK(("triage_records"."urgency_is_er" = 1 and "triage_records"."urgency_rank" is null and "triage_records"."sort_group" is null) or ("triage_records"."urgency_is_er" = 0 and "triage_records"."urgency_rank" is not null and "triage_records"."sort_group" in (1, 2, 3))),
	CONSTRAINT "triage_records_priority_id_status_check" CHECK("triage_records"."priority_id_status" is null or "triage_records"."priority_id_status" in ('on_file', 'entered', 'not_presented'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `triage_records_visit_unique` ON `triage_records` (`visit_id`);--> statement-breakpoint
CREATE INDEX `triage_records_patient_idx` ON `triage_records` (`patient_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`opd_date` text NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visits_status_check" CHECK("visits"."status" in ('open', 'in_queue', 'completed', 'directed_to_er', 'no_show', 'cancelled')),
	CONSTRAINT "visits_opd_date_check" CHECK("visits"."opd_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE INDEX `visits_patient_idx` ON `visits` (`patient_id`,`opd_date`);--> statement-breakpoint
CREATE INDEX `visits_opd_date_status_idx` ON `visits` (`opd_date`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `visits_one_active_unique` ON `visits` (`patient_id`,`opd_date`) WHERE "visits"."status" in ('open', 'in_queue');