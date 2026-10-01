-- Story 3.5: the `queue` module's tables. Queue Numbers are issued from
-- queue_counters inside the triage command; queue_entries copies the priority snapshot.
CREATE TABLE `queue_counters` (
	`facility_id` text NOT NULL,
	`opd_date` text NOT NULL,
	`last_seq` integer NOT NULL,
	PRIMARY KEY(`facility_id`, `opd_date`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_counters_seq_check" CHECK("queue_counters"."last_seq" >= 0),
	CONSTRAINT "queue_counters_opd_date_check" CHECK("queue_counters"."opd_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE TABLE `queue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`opd_date` text NOT NULL,
	`prefix` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`sort_group` integer NOT NULL,
	`urgency_rank` integer NOT NULL,
	`urgency_level_id` text NOT NULL,
	`priority_category` text,
	`entered_at` text NOT NULL,
	`call_count` integer DEFAULT 0 NOT NULL,
	`is_paper` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`urgency_level_id`) REFERENCES `urgency_levels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_entries_status_check" CHECK("queue_entries"."status" in ('waiting', 'called', 'serving', 'completed', 'referred', 'no_show', 'cancelled')),
	CONSTRAINT "queue_entries_sort_group_check" CHECK("queue_entries"."sort_group" in (1, 2, 3)),
	CONSTRAINT "queue_entries_urgency_rank_check" CHECK("queue_entries"."urgency_rank" >= 1),
	CONSTRAINT "queue_entries_seq_check" CHECK("queue_entries"."seq" >= 1),
	CONSTRAINT "queue_entries_call_count_check" CHECK("queue_entries"."call_count" >= 0),
	CONSTRAINT "queue_entries_prefix_check" CHECK("queue_entries"."prefix" glob '[A-Z][A-Z]' or "queue_entries"."prefix" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "queue_entries_opd_date_check" CHECK("queue_entries"."opd_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_entries_seq_unique` ON `queue_entries` (`facility_id`,`opd_date`,`seq`);--> statement-breakpoint
CREATE INDEX `queue_entries_live_idx` ON `queue_entries` (`facility_id`,`opd_date`,`status`);--> statement-breakpoint
CREATE INDEX `queue_entries_visit_idx` ON `queue_entries` (`visit_id`);