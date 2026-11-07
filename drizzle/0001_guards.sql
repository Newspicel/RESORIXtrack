-- Database guards (second line of defence behind the services): nothing can change time data inside an
-- active signed-off month, edit or delete sign-off records, or rewrite the change log. Released migrations
-- are never edited; changing a guard requires a new migration.
CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_ins BEFORE INSERT ON time_entries FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.start_at < s.period_end_utc AND COALESCE(NEW.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_upd BEFORE UPDATE ON time_entries FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.start_at < s.period_end_utc AND COALESCE(OLD.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.start_at < s.period_end_utc AND COALESCE(NEW.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_time_entries_del BEFORE DELETE ON time_entries FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.start_at < s.period_end_utc AND COALESCE(OLD.end_at, '9999-12-31T00:00:00.000000Z') > s.period_start_utc) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_ins BEFORE INSERT ON absences FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.start_date <= s.period_end_date AND NEW.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_upd BEFORE UPDATE ON absences FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.start_date <= s.period_end_date AND OLD.end_date >= s.period_start_date) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.start_date <= s.period_end_date AND NEW.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_absences_del BEFORE DELETE ON absences FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.start_date <= s.period_end_date AND OLD.end_date >= s.period_start_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_ins BEFORE INSERT ON balance_adjustments FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.effective_date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_upd BEFORE UPDATE ON balance_adjustments FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.effective_date BETWEEN s.period_start_date AND s.period_end_date) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.effective_date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_adjustments_del BEFORE DELETE ON balance_adjustments FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.effective_date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_ins BEFORE INSERT ON work_logs FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_upd BEFORE UPDATE ON work_logs FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.date BETWEEN s.period_start_date AND s.period_end_date) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_work_logs_del BEFORE DELETE ON work_logs FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.date BETWEEN s.period_start_date AND s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_ins BEFORE INSERT ON work_schedules FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_upd BEFORE UPDATE ON work_schedules FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.valid_from <= s.period_end_date) OR EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND NEW.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_schedules_del BEFORE DELETE ON work_schedules FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND OLD.valid_from <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_users_employment BEFORE UPDATE OF employment_start, employment_end ON users FOR EACH ROW WHEN (OLD.employment_start IS NOT NEW.employment_start OR OLD.employment_end IS NOT NEW.employment_end) AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND MIN(COALESCE(OLD.employment_start, '0001-01-01'), COALESCE(NEW.employment_start, '0001-01-01'), COALESCE(OLD.employment_end, '9999-12-31'), COALESCE(NEW.employment_end, '9999-12-31')) <= s.period_end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_ins BEFORE INSERT ON holidays FOR EACH ROW WHEN NEW.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_upd BEFORE UPDATE ON holidays FOR EACH ROW WHEN OLD.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) OR NEW.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoff_holidays_del BEFORE DELETE ON holidays FOR EACH ROW WHEN OLD.date <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoffs_no_delete BEFORE DELETE ON month_signoffs FOR EACH ROW WHEN 1 BEGIN SELECT RAISE(ABORT, 'resorixtrack: sign-offs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_signoffs_immutable BEFORE UPDATE ON month_signoffs FOR EACH ROW WHEN OLD.reopened_at IS NOT NULL OR NEW.reopened_at IS NULL OR NEW.user_id IS NOT OLD.user_id OR NEW.month IS NOT OLD.month OR NEW.period_start_date IS NOT OLD.period_start_date OR NEW.period_end_date IS NOT OLD.period_end_date OR NEW.period_start_utc IS NOT OLD.period_start_utc OR NEW.period_end_utc IS NOT OLD.period_end_utc OR NEW.signed_by_id IS NOT OLD.signed_by_id OR NEW.signed_at IS NOT OLD.signed_at OR NEW.snapshot IS NOT OLD.snapshot OR NEW.digest IS NOT OLD.digest OR NEW.seal IS NOT OLD.seal OR NEW.prev_seal IS NOT OLD.prev_seal OR NEW.seal_version IS NOT OLD.seal_version BEGIN SELECT RAISE(ABORT, 'resorixtrack: sign-offs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_revisions_no_update BEFORE UPDATE ON revisions FOR EACH ROW WHEN 1 BEGIN SELECT RAISE(ABORT, 'resorixtrack: change log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_revisions_no_delete BEFORE DELETE ON revisions FOR EACH ROW WHEN 1 BEGIN SELECT RAISE(ABORT, 'resorixtrack: change log is append-only'); END;
