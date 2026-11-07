ALTER TABLE `time_entries` ADD `scheduled_end_at` text;--> statement-breakpoint
-- A break is simply a clock-out. Legacy break entries (1.x data, or a 2.x database seeded before this change)
-- are retired the way a person deletes an entry: soft-deleted with a revision row. Entries inside signed-off
-- months stay as they are (immutable; the guard trigger would refuse the update anyway).
INSERT INTO `revisions` (`entity`, `entity_id`, `subject_user_id`, `actor_id`, `action`, `before`, `after`, `reason`, `source`, `at`)
SELECT 'time_entry', e.id, e.user_id, NULL, 'delete',
  json_object('kind', e.kind, 'start_at', e.start_at, 'end_at', e.end_at, 'scheduled_end_at', NULL, 'tz', e.tz, 'note', e.note, 'source', e.source, 'is_deleted', json('false')),
  json_object('kind', e.kind, 'start_at', e.start_at, 'end_at', COALESCE(e.end_at, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'), 'scheduled_end_at', NULL, 'tz', e.tz, 'note', e.note, 'source', e.source, 'is_deleted', json('true')),
  'Pauses were removed from RESORIXtrack: a break is a clock-out (migration 0006)', 'migration',
  strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'
FROM `time_entries` e
WHERE e.kind = 'break' AND e.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM `month_signoffs` s WHERE s.user_id = e.user_id AND s.reopened_at IS NULL
                  AND e.start_at < s.period_end_utc AND COALESCE(e.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc);
--> statement-breakpoint
UPDATE `time_entries` SET `is_deleted` = 1,
  `end_at` = COALESCE(`end_at`, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%f', 'now') || '000Z'
WHERE `kind` = 'break' AND `is_deleted` = 0
  AND NOT EXISTS (SELECT 1 FROM `month_signoffs` s WHERE s.user_id = `time_entries`.user_id AND s.reopened_at IS NULL
                  AND `time_entries`.start_at < s.period_end_utc AND COALESCE(`time_entries`.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc);
