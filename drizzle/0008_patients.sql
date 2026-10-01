CREATE TABLE `hospital_number_counters` (
	`year` integer PRIMARY KEY NOT NULL,
	`last_seq` integer NOT NULL,
	CONSTRAINT "hospital_number_counters_year_check" CHECK("hospital_number_counters"."year" between 1900 and 9999),
	CONSTRAINT "hospital_number_counters_seq_check" CHECK("hospital_number_counters"."last_seq" between 0 and 999999)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_number` text NOT NULL,
	`last_name` text NOT NULL,
	`first_name` text NOT NULL,
	`middle_name` text,
	`suffix` text,
	`sex` text NOT NULL,
	`birthdate` text NOT NULL,
	`address_barangay` text NOT NULL,
	`address_municipality` text NOT NULL,
	`contact_number` text NOT NULL,
	`philhealth_pin` text,
	`senior_citizen_id` text,
	`pwd_id` text,
	`emergency_contact_name` text,
	`emergency_contact_number` text,
	`privacy_notice_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`deactivated_at` text,
	CONSTRAINT "patients_sex_check" CHECK("patients"."sex" in ('female', 'male')),
	CONSTRAINT "patients_hospital_number_check" CHECK("patients"."hospital_number" glob 'HN-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "patients_birthdate_check" CHECK("patients"."birthdate" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "patients_names_check" CHECK(length(trim("patients"."last_name")) > 0 and length(trim("patients"."first_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_hospital_number_unique` ON `patients` (`hospital_number`);--> statement-breakpoint
CREATE INDEX `patients_name_idx` ON `patients` ("last_name" collate nocase,"first_name" collate nocase);--> statement-breakpoint
CREATE INDEX `patients_birthdate_idx` ON `patients` (`birthdate`);