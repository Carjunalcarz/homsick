CREATE TABLE `user_facilities` (
	`user_id` text NOT NULL,
	`facility_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `facility_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_facilities_facility_id_idx` ON `user_facilities` (`facility_id`);