CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`key` text NOT NULL,
	`opd_date` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error` text,
	CONSTRAINT "job_runs_status_check" CHECK("job_runs"."status" in ('running', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_started_at_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_job_key_unique` ON `job_runs` (`job`,`key`);