ALTER TABLE `users` ADD `regular_night_work` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- the surcharge used to be credited as time: keep that for installs that set one (new default: payroll only)
INSERT INTO `settings` (`key`, `value`) SELECT 'holiday_work_surcharge_mode', '"time_credit"'
  WHERE EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'holiday_work_surcharge_percent' AND CAST(`value` AS REAL) > 0)
  AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'holiday_work_surcharge_mode');
--> statement-breakpoint
-- existing installs keep their former default of 0 %; only new installs start with 50 %
INSERT INTO `settings` (`key`, `value`) SELECT 'holiday_work_surcharge_percent', '0'
  WHERE EXISTS (SELECT 1 FROM `users`)
  AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'holiday_work_surcharge_percent');
--> statement-breakpoint
-- calendars keep their preset key in region_code; the City of Fribourg preset used the canton's code
UPDATE `holiday_calendars` SET `region_code` = 'ch-fr-fribourg'
  WHERE `name` = 'CH-FR City of Fribourg' AND `region_code` = 'CH-FR';
