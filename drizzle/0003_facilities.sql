CREATE TABLE `facilities` (
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
	CONSTRAINT "facilities_prefix_check" CHECK("facilities"."prefix" glob '[A-Z][A-Z]' or "facilities"."prefix" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "facilities_next_prefix_check" CHECK(("facilities"."next_prefix" is null and "facilities"."next_prefix_from" is null) or ("facilities"."next_prefix" is not null and "facilities"."next_prefix_from" is not null)),
	CONSTRAINT "facilities_hours_check" CHECK("facilities"."close_time" > "facilities"."open_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_active_name_unique` ON `facilities` (`name`) WHERE "facilities"."deactivated_at" is null;
--> statement-breakpoint
-- Seed: the PRD's default Facilities (FR23), all live, open Mon-Sat 07:00-17:00.
-- This is the only place the Facility list is written down; Admins edit it at /admin/settings.
INSERT INTO `facilities` (`id`, `name`, `prefix`, `next_prefix`, `next_prefix_from`, `open_days`, `open_time`, `close_time`, `is_live`, `sort_order`, `deactivated_at`, `created_at`, `updated_at`) VALUES
	('3f1c2a8e-5b7d-4c1e-9a2f-6d8b0e4c7a11', 'Prenatal', 'PN', NULL, NULL, '[1,2,3,4,5,6]', '07:00', '17:00', 1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('8a4e6b2c-1d3f-4e5a-b7c9-0f2d4e6a8b22', 'Animal Bite Center', 'AB', NULL, NULL, '[1,2,3,4,5,6]', '07:00', '17:00', 1, 2, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('c5d7e9f1-2a4b-4c6d-8e0f-1a3b5c7d9e33', 'Treatment', 'TR', NULL, NULL, '[1,2,3,4,5,6]', '07:00', '17:00', 1, 3, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('e2f4a6b8-3c5d-4e7f-9a1b-2c4d6e8f0a44', 'Consultation', 'CN', NULL, NULL, '[1,2,3,4,5,6]', '07:00', '17:00', 1, 4, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
