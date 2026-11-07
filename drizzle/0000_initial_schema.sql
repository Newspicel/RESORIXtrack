CREATE TABLE `absence_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT '#8a8d93' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`credits_time` integer DEFAULT true NOT NULL,
	`deducts_vacation` integer DEFAULT false NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`allows_attachments` integer DEFAULT false NOT NULL,
	`employee_can_request` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absence_types_key_unique` ON `absence_types` (`key`);--> statement-breakpoint
CREATE TABLE `absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_half` text DEFAULT 'full' NOT NULL,
	`end_half` text DEFAULT 'full' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by_id` integer,
	`decided_by_id` integer,
	`decided_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`cancelled_by_id` integer,
	`cancelled_at` text,
	`cancel_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `absence_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_absences_user_dates` ON `absences` (`user_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `ix_absences_dates` ON `absences` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `ix_absences_pending` ON `absences` (`user_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer DEFAULT 86400000,
	`rate_limit_max` integer DEFAULT 10,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`absence_id` integer NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_name` text NOT NULL,
	`uploaded_by_id` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`absence_id`) REFERENCES `absences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storageName_unique` ON `attachments` (`storage_name`);--> statement-breakpoint
CREATE INDEX `ix_attachments_absence` ON `attachments` (`absence_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_tokenHash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ix_auth_tokens_user` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `balance_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`account` text NOT NULL,
	`amount` real NOT NULL,
	`effective_date` text NOT NULL,
	`kind` text DEFAULT 'correction' NOT NULL,
	`reason` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_by_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_balance_adjustments_user_date` ON `balance_adjustments` (`user_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `holiday_calendars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`region_code` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_calendars_name_unique` ON `holiday_calendars` (`name`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`fraction` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `holiday_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_holidays_calendar_date` ON `holidays` (`calendar_id`,`date`);--> statement-breakpoint
CREATE INDEX `ix_holidays_date` ON `holidays` (`date`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`user_id` integer,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`success` integer DEFAULT false NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_login_attempts_email_at` ON `login_attempts` (`email`,`at`);--> statement-breakpoint
CREATE INDEX `ix_login_attempts_user` ON `login_attempts` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_login_attempts_at` ON `login_attempts` (`at`);--> statement-breakpoint
CREATE TABLE `month_signoffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`month` text NOT NULL,
	`period_start_date` text NOT NULL,
	`period_end_date` text NOT NULL,
	`period_start_utc` text NOT NULL,
	`period_end_utc` text NOT NULL,
	`signed_by_id` integer,
	`signed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`digest` text NOT NULL,
	`prev_seal` text DEFAULT '' NOT NULL,
	`seal` text NOT NULL,
	`seal_version` integer DEFAULT 2 NOT NULL,
	`reopened_at` text,
	`reopened_by_id` integer,
	`reopen_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`signed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reopened_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_month_signoffs_user_month` ON `month_signoffs` (`user_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_month_signoffs_active` ON `month_signoffs` (`user_id`,`month`) WHERE reopened_at IS NULL;--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_notifications_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_notifications_user_unread` ON `notifications` (`user_id`) WHERE read_at IS NULL;--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#35a1cc' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`team_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE INDEX `ix_projects_team` ON `projects` (`team_id`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`subject_user_id` integer,
	`actor_id` integer,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_revisions_entity` ON `revisions` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_revisions_subject_at` ON `revisions` (`subject_user_id`,`at`);--> statement-breakpoint
CREATE INDEX `ix_revisions_at` ON `revisions` (`at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `team_leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'lead' NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_by_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_team_leads_team_user` ON `team_leads` (`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `ix_team_leads_user` ON `team_leads` (`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#35a1cc' NOT NULL,
	`holiday_calendar_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`holiday_calendar_id`) REFERENCES `holiday_calendars`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_name_unique` ON `teams` (`name`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text DEFAULT 'work' NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`tz` text DEFAULT 'Europe/Zurich' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'clock' NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_by_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_time_entries_user_start` ON `time_entries` (`user_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `ix_time_entries_start` ON `time_entries` (`start_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_time_entries_open` ON `time_entries` (`user_id`) WHERE end_at IS NULL AND is_deleted = 0;--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` integer NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`two_factor_enabled` integer DEFAULT false,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text DEFAULT 'employee' NOT NULL,
	`team_id` integer,
	`holiday_calendar_id` integer,
	`timezone` text DEFAULT 'Europe/Zurich' NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`time_format` text DEFAULT '24h' NOT NULL,
	`employment_start` text,
	`employment_end` text,
	`vacation_days_per_year` real DEFAULT 25 NOT NULL,
	`password_changed_at` text,
	`is_active` integer DEFAULT true NOT NULL,
	`notify_email_on_correction` integer DEFAULT true NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`last_login_at` text,
	`mfa_reenrol_required` integer DEFAULT false NOT NULL,
	`legal_weekly_max_hours` integer DEFAULT 45 NOT NULL,
	`recording_mode` text DEFAULT 'full' NOT NULL,
	`birth_date` text,
	`anonymized_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`holiday_calendar_id`) REFERENCES `holiday_calendars`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `ix_users_team` ON `users` (`team_id`);--> statement-breakpoint
CREATE INDEX `ix_users_active_name` ON `users` (`is_active`,`name`);--> statement-breakpoint
CREATE TABLE `vacation_entitlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`year` integer NOT NULL,
	`days` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vacation_entitlements_user_year` ON `vacation_entitlements` (`user_id`,`year`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `work_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`date` text NOT NULL,
	`project_id` integer,
	`minutes` integer NOT NULL,
	`start_time` text,
	`end_time` text,
	`customer_ref` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_id` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_work_logs_user_date` ON `work_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `ix_work_logs_project_date` ON `work_logs` (`project_id`,`date`);--> statement-breakpoint
CREATE TABLE `work_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`pensum_percent` real DEFAULT 100 NOT NULL,
	`minutes_mon` integer DEFAULT 0 NOT NULL,
	`minutes_tue` integer DEFAULT 0 NOT NULL,
	`minutes_wed` integer DEFAULT 0 NOT NULL,
	`minutes_thu` integer DEFAULT 0 NOT NULL,
	`minutes_fri` integer DEFAULT 0 NOT NULL,
	`minutes_sat` integer DEFAULT 0 NOT NULL,
	`minutes_sun` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_schedules_user_from` ON `work_schedules` (`user_id`,`valid_from`);