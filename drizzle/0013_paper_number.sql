-- Story 3.5 review: the not-live Facility a paper number was given for (nullable FK),
-- and a per-day index for waitingCounts().
ALTER TABLE `triage_records` ADD `paper_facility_id` text REFERENCES facilities(id);--> statement-breakpoint
CREATE INDEX `queue_entries_day_status_idx` ON `queue_entries` (`opd_date`,`status`);