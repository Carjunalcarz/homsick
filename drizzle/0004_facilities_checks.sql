PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`next_prefix` text,
	`next_prefix_from` text,
	`open_days` text NOT NULL,
	`open_time` text NOT NULL,
	`close_time` text NOT NULL,
	`is_live` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`deactivated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "facilities_prefix_check" CHECK("__new_facilities"."prefix" glob '[A-Z][A-Z]' or "__new_facilities"."prefix" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "facilities_next_prefix_check" CHECK(("__new_facilities"."next_prefix" is null and "__new_facilities"."next_prefix_from" is null) or ("__new_facilities"."next_prefix" is not null and "__new_facilities"."next_prefix_from" is not null)),
	CONSTRAINT "facilities_next_prefix_shape_check" CHECK("__new_facilities"."next_prefix" is null or "__new_facilities"."next_prefix" glob '[A-Z][A-Z]' or "__new_facilities"."next_prefix" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "facilities_next_prefix_from_check" CHECK("__new_facilities"."next_prefix_from" is null or "__new_facilities"."next_prefix_from" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "facilities_open_days_check" CHECK(json_valid("__new_facilities"."open_days")),
	CONSTRAINT "facilities_times_check" CHECK("__new_facilities"."open_time" glob '[0-2][0-9]:[0-5][0-9]' and "__new_facilities"."close_time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "facilities_hours_check" CHECK("__new_facilities"."close_time" > "__new_facilities"."open_time")
);
--> statement-breakpoint
INSERT INTO `__new_facilities`("id", "name", "prefix", "next_prefix", "next_prefix_from", "open_days", "open_time", "close_time", "is_live", "sort_order", "deactivated_at", "created_at", "updated_at") SELECT "id", "name", "prefix", "next_prefix", "next_prefix_from", "open_days", "open_time", "close_time", "is_live", "sort_order", "deactivated_at", "created_at", "updated_at" FROM `facilities`;--> statement-breakpoint
DROP TABLE `facilities`;--> statement-breakpoint
ALTER TABLE `__new_facilities` RENAME TO `facilities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_active_name_unique` ON `facilities` ("name" COLLATE NOCASE) WHERE "facilities"."deactivated_at" is null;