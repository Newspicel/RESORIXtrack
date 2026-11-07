-- Employment dates: check start and end separately. A changed start shifts every balance from the earlier of
-- the two dates on; a changed end only affects days from the earlier end on (v1 combined both and refused
-- any end date once a month after the start was signed off).
DROP TRIGGER IF EXISTS trg_signoff_users_employment;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_users_employment BEFORE UPDATE OF employment_start, employment_end ON users FOR EACH ROW WHEN (OLD.employment_start IS NOT NEW.employment_start AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND MIN(COALESCE(OLD.employment_start, '0001-01-01'), COALESCE(NEW.employment_start, '0001-01-01')) <= s.period_end_date)) OR (OLD.employment_end IS NOT NEW.employment_end AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND MIN(COALESCE(OLD.employment_end, '9999-12-31'), COALESCE(NEW.employment_end, '9999-12-31')) <= s.period_end_date)) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
-- Change log stays append-only. Single exception (revDSG erasure after the retention period): the
-- anonymisation service may rewrite the before/after snapshots of a person's own user-entity revisions while
-- app_state holds key 'revision_scrub' = that person's id, inside the same transaction.
DROP TRIGGER IF EXISTS trg_revisions_no_update;
--> statement-breakpoint
CREATE TRIGGER trg_revisions_no_update BEFORE UPDATE ON revisions FOR EACH ROW WHEN NOT (OLD.entity = 'user' AND NEW.entity = 'user' AND NEW.id = OLD.id AND NEW.entity_id = OLD.entity_id AND NEW.action IS OLD.action AND NEW.at IS OLD.at AND NEW.actor_id IS OLD.actor_id AND NEW.subject_user_id IS OLD.subject_user_id AND NEW.reason IS OLD.reason AND NEW.source IS OLD.source AND EXISTS (SELECT 1 FROM app_state a WHERE a.key = 'revision_scrub' AND a.value = CAST(OLD.entity_id AS TEXT))) BEGIN SELECT RAISE(ABORT, 'resorixtrack: change log is append-only'); END;
