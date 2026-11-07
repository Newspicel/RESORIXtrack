/** RESORIXtrack 1.x schema at Alembic revision 0001 (tables and indexes, dumped from a v1 database). Test fixture. */
export const V1_SCHEMA_0001 = `
CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL,
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
CREATE TABLE absence_types (
	id INTEGER NOT NULL,
	"key" VARCHAR(32) NOT NULL,
	label VARCHAR(80) NOT NULL,
	color VARCHAR(16) NOT NULL,
	category VARCHAR(16) NOT NULL,
	credits_time BOOLEAN NOT NULL,
	deducts_vacation BOOLEAN NOT NULL,
	requires_approval BOOLEAN NOT NULL,
	allows_attachments BOOLEAN NOT NULL,
	employee_can_request BOOLEAN NOT NULL,
	is_active BOOLEAN NOT NULL,
	sort INTEGER NOT NULL,
	CONSTRAINT pk_absence_types PRIMARY KEY (id),
	CONSTRAINT uq_absence_types_key UNIQUE ("key")
);
CREATE TABLE holiday_calendars (
	id INTEGER NOT NULL,
	name VARCHAR(120) NOT NULL,
	region_code VARCHAR(32) NOT NULL,
	description VARCHAR(500) NOT NULL,
	is_default BOOLEAN NOT NULL,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_holiday_calendars PRIMARY KEY (id),
	CONSTRAINT uq_holiday_calendars_name UNIQUE (name)
);
CREATE TABLE settings (
	"key" VARCHAR(64) NOT NULL,
	value JSON NOT NULL,
	CONSTRAINT pk_settings PRIMARY KEY ("key")
);
CREATE TABLE holidays (
	id INTEGER NOT NULL,
	calendar_id INTEGER NOT NULL,
	date DATE NOT NULL,
	name VARCHAR(120) NOT NULL,
	fraction FLOAT NOT NULL,
	CONSTRAINT pk_holidays PRIMARY KEY (id),
	CONSTRAINT fk_holidays_calendar_id_holiday_calendars FOREIGN KEY(calendar_id) REFERENCES holiday_calendars (id) ON DELETE CASCADE,
	CONSTRAINT uq_holidays_calendar_id UNIQUE (calendar_id, date)
);
CREATE TABLE teams (
	id INTEGER NOT NULL,
	name VARCHAR(120) NOT NULL,
	color VARCHAR(16) NOT NULL,
	holiday_calendar_id INTEGER,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_teams PRIMARY KEY (id),
	CONSTRAINT fk_teams_holiday_calendar_id_holiday_calendars FOREIGN KEY(holiday_calendar_id) REFERENCES holiday_calendars (id) ON DELETE SET NULL,
	CONSTRAINT uq_teams_name UNIQUE (name)
);
CREATE TABLE users (
	id INTEGER NOT NULL,
	email VARCHAR(254) NOT NULL,
	name VARCHAR(120) NOT NULL,
	role VARCHAR(16) NOT NULL,
	team_id INTEGER,
	holiday_calendar_id INTEGER,
	timezone VARCHAR(64) NOT NULL,
	locale VARCHAR(16) NOT NULL,
	employment_start DATE,
	employment_end DATE,
	vacation_days_per_year FLOAT NOT NULL,
	password_hash VARCHAR(255),
	password_changed_at DATETIME,
	totp_secret VARCHAR(255),
	totp_enabled_at DATETIME,
	totp_recovery_codes JSON,
	totp_last_step INTEGER,
	is_active BOOLEAN NOT NULL,
	notify_email_on_correction BOOLEAN NOT NULL,
	capabilities JSON,
	created_at DATETIME NOT NULL,
	last_login_at DATETIME,
	CONSTRAINT pk_users PRIMARY KEY (id),
	CONSTRAINT fk_users_holiday_calendar_id_holiday_calendars FOREIGN KEY(holiday_calendar_id) REFERENCES holiday_calendars (id) ON DELETE SET NULL,
	CONSTRAINT fk_users_team_id_teams FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE SET NULL
);
CREATE TABLE absences (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	type_id INTEGER NOT NULL,
	start_date DATE NOT NULL,
	end_date DATE NOT NULL,
	start_half VARCHAR(4) NOT NULL,
	end_half VARCHAR(4) NOT NULL,
	note VARCHAR(1000) NOT NULL,
	status VARCHAR(16) NOT NULL,
	requested_by_id INTEGER,
	decided_by_id INTEGER,
	decided_at DATETIME,
	decision_note VARCHAR(1000) NOT NULL,
	cancelled_by_id INTEGER,
	cancelled_at DATETIME,
	cancel_reason VARCHAR(1000) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	CONSTRAINT pk_absences PRIMARY KEY (id),
	CONSTRAINT fk_absences_cancelled_by_id_users FOREIGN KEY(cancelled_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_absences_decided_by_id_users FOREIGN KEY(decided_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_absences_requested_by_id_users FOREIGN KEY(requested_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_absences_type_id_absence_types FOREIGN KEY(type_id) REFERENCES absence_types (id),
	CONSTRAINT fk_absences_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE api_tokens (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	name VARCHAR(80) NOT NULL,
	prefix VARCHAR(16) NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	scopes VARCHAR(255) NOT NULL,
	last_used_at DATETIME,
	created_ip VARCHAR(64) DEFAULT '' NOT NULL,
	last_used_ip VARCHAR(64) DEFAULT '' NOT NULL,
	use_count INTEGER DEFAULT '0' NOT NULL,
	expires_at DATETIME,
	revoked_at DATETIME,
	revoked_by_id INTEGER,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_api_tokens PRIMARY KEY (id),
	CONSTRAINT fk_api_tokens_revoked_by_id_users FOREIGN KEY(revoked_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_api_tokens_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT uq_api_tokens_token_hash UNIQUE (token_hash)
);
CREATE TABLE auth_tokens (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	purpose VARCHAR(16) NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	expires_at DATETIME NOT NULL,
	used_at DATETIME,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_auth_tokens PRIMARY KEY (id),
	CONSTRAINT fk_auth_tokens_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT uq_auth_tokens_token_hash UNIQUE (token_hash)
);
CREATE TABLE balance_adjustments (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	account VARCHAR(16) NOT NULL,
	amount FLOAT NOT NULL,
	effective_date DATE NOT NULL,
	kind VARCHAR(16) NOT NULL,
	reason VARCHAR(500) NOT NULL,
	is_deleted BOOLEAN NOT NULL,
	created_by_id INTEGER,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_balance_adjustments PRIMARY KEY (id),
	CONSTRAINT fk_balance_adjustments_created_by_id_users FOREIGN KEY(created_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_balance_adjustments_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE login_attempts (
	id INTEGER NOT NULL,
	email VARCHAR(254) NOT NULL,
	user_id INTEGER,
	ip VARCHAR(64) NOT NULL,
	user_agent VARCHAR(300) DEFAULT '' NOT NULL,
	success BOOLEAN NOT NULL,
	reason VARCHAR(32) DEFAULT '' NOT NULL,
	at DATETIME NOT NULL,
	CONSTRAINT pk_login_attempts PRIMARY KEY (id),
	CONSTRAINT fk_login_attempts_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE TABLE month_signoffs (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	month VARCHAR(7) NOT NULL,
	period_start_date DATE NOT NULL,
	period_end_date DATE NOT NULL,
	period_start_utc DATETIME NOT NULL,
	period_end_utc DATETIME NOT NULL,
	signed_by_id INTEGER,
	signed_at DATETIME NOT NULL,
	note VARCHAR(500) NOT NULL,
	snapshot JSON NOT NULL,
	digest VARCHAR(64) NOT NULL,
	prev_seal VARCHAR(64) NOT NULL,
	seal VARCHAR(64) NOT NULL,
	reopened_at DATETIME,
	reopened_by_id INTEGER,
	reopen_reason VARCHAR(500) NOT NULL,
	CONSTRAINT pk_month_signoffs PRIMARY KEY (id),
	CONSTRAINT fk_month_signoffs_reopened_by_id_users FOREIGN KEY(reopened_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_month_signoffs_signed_by_id_users FOREIGN KEY(signed_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_month_signoffs_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT
);
CREATE TABLE notifications (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	kind VARCHAR(32) NOT NULL,
	payload JSON NOT NULL,
	read_at DATETIME,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_notifications PRIMARY KEY (id),
	CONSTRAINT fk_notifications_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE projects (
	id INTEGER NOT NULL,
	name VARCHAR(120) NOT NULL,
	code VARCHAR(30) NOT NULL,
	color VARCHAR(16) NOT NULL,
	description VARCHAR(500) NOT NULL,
	team_id INTEGER,
	is_active BOOLEAN NOT NULL,
	created_by_id INTEGER,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	CONSTRAINT pk_projects PRIMARY KEY (id),
	CONSTRAINT fk_projects_created_by_id_users FOREIGN KEY(created_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_projects_team_id_teams FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE SET NULL,
	CONSTRAINT uq_projects_name UNIQUE (name)
);
CREATE TABLE revisions (
	id INTEGER NOT NULL,
	entity VARCHAR(32) NOT NULL,
	entity_id INTEGER NOT NULL,
	subject_user_id INTEGER,
	actor_id INTEGER,
	action VARCHAR(16) NOT NULL,
	"before" JSON,
	"after" JSON,
	reason VARCHAR(500) NOT NULL,
	source VARCHAR(16) NOT NULL,
	at DATETIME NOT NULL,
	CONSTRAINT pk_revisions PRIMARY KEY (id),
	CONSTRAINT fk_revisions_actor_id_users FOREIGN KEY(actor_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_revisions_subject_user_id_users FOREIGN KEY(subject_user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE TABLE team_leads (
	id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	role VARCHAR(16) NOT NULL,
	valid_from DATE,
	valid_to DATE,
	created_by_id INTEGER,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_team_leads PRIMARY KEY (id),
	CONSTRAINT fk_team_leads_created_by_id_users FOREIGN KEY(created_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_team_leads_team_id_teams FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE CASCADE,
	CONSTRAINT fk_team_leads_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE time_entries (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	kind VARCHAR(8) NOT NULL,
	start_at DATETIME NOT NULL,
	end_at DATETIME,
	tz VARCHAR(64) NOT NULL,
	note VARCHAR(500) NOT NULL,
	source VARCHAR(16) NOT NULL,
	is_deleted BOOLEAN NOT NULL,
	created_by_id INTEGER,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	CONSTRAINT pk_time_entries PRIMARY KEY (id),
	CONSTRAINT fk_time_entries_created_by_id_users FOREIGN KEY(created_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_time_entries_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE user_sessions (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	csrf_token VARCHAR(64) NOT NULL,
	remember BOOLEAN NOT NULL,
	user_agent VARCHAR(300) NOT NULL,
	ip VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	revoked_at DATETIME,
	CONSTRAINT pk_user_sessions PRIMARY KEY (id),
	CONSTRAINT fk_user_sessions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT uq_user_sessions_token_hash UNIQUE (token_hash)
);
CREATE TABLE vacation_entitlements (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	year INTEGER NOT NULL,
	days FLOAT NOT NULL,
	note VARCHAR(500) NOT NULL,
	CONSTRAINT pk_vacation_entitlements PRIMARY KEY (id),
	CONSTRAINT fk_vacation_entitlements_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT uq_vacation_entitlements_user_id UNIQUE (user_id, year)
);
CREATE TABLE work_schedules (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	valid_from DATE NOT NULL,
	pensum_percent FLOAT NOT NULL,
	minutes_mon INTEGER NOT NULL,
	minutes_tue INTEGER NOT NULL,
	minutes_wed INTEGER NOT NULL,
	minutes_thu INTEGER NOT NULL,
	minutes_fri INTEGER NOT NULL,
	minutes_sat INTEGER NOT NULL,
	minutes_sun INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_work_schedules PRIMARY KEY (id),
	CONSTRAINT fk_work_schedules_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT uq_work_schedules_user_id UNIQUE (user_id, valid_from)
);
CREATE TABLE attachments (
	id INTEGER NOT NULL,
	absence_id INTEGER NOT NULL,
	filename VARCHAR(255) NOT NULL,
	content_type VARCHAR(100) NOT NULL,
	size INTEGER NOT NULL,
	sha256 VARCHAR(64) NOT NULL,
	storage_name VARCHAR(64) NOT NULL,
	uploaded_by_id INTEGER,
	is_deleted BOOLEAN NOT NULL,
	created_at DATETIME NOT NULL,
	CONSTRAINT pk_attachments PRIMARY KEY (id),
	CONSTRAINT fk_attachments_absence_id_absences FOREIGN KEY(absence_id) REFERENCES absences (id) ON DELETE CASCADE,
	CONSTRAINT fk_attachments_uploaded_by_id_users FOREIGN KEY(uploaded_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT uq_attachments_storage_name UNIQUE (storage_name)
);
CREATE TABLE work_logs (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	date DATE NOT NULL,
	project_id INTEGER,
	minutes INTEGER NOT NULL,
	start_time TIME,
	end_time TIME,
	customer_ref VARCHAR(60) NOT NULL,
	note VARCHAR(2000) NOT NULL,
	created_by_id INTEGER,
	is_deleted BOOLEAN NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	CONSTRAINT pk_work_logs PRIMARY KEY (id),
	CONSTRAINT fk_work_logs_created_by_id_users FOREIGN KEY(created_by_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_work_logs_project_id_projects FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE SET NULL,
	CONSTRAINT fk_work_logs_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_holidays_date ON holidays (date);
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE INDEX ix_users_team_id ON users (team_id);
CREATE INDEX ix_absences_status ON absences (status);
CREATE INDEX ix_absences_user_dates ON absences (user_id, start_date, end_date);
CREATE INDEX ix_api_tokens_user_id ON api_tokens (user_id);
CREATE INDEX ix_auth_tokens_user_id ON auth_tokens (user_id);
CREATE INDEX ix_balance_adjustments_user_id ON balance_adjustments (user_id);
CREATE INDEX ix_login_attempts_at ON login_attempts (at);
CREATE INDEX ix_login_attempts_email_at ON login_attempts (email, at);
CREATE INDEX ix_login_attempts_user_id ON login_attempts (user_id);
CREATE INDEX ix_month_signoffs_user_month ON month_signoffs (user_id, month);
CREATE UNIQUE INDEX uq_month_signoffs_active ON month_signoffs (user_id, month) WHERE reopened_at IS NULL;
CREATE INDEX ix_notifications_user_id ON notifications (user_id);
CREATE INDEX ix_projects_team_id ON projects (team_id);
CREATE INDEX ix_revisions_at ON revisions (at);
CREATE INDEX ix_revisions_entity ON revisions (entity, entity_id);
CREATE INDEX ix_revisions_subject_user_id ON revisions (subject_user_id);
CREATE INDEX ix_team_leads_team_user ON team_leads (team_id, user_id);
CREATE INDEX ix_team_leads_user_id ON team_leads (user_id);
CREATE INDEX ix_time_entries_user_start ON time_entries (user_id, start_at);
CREATE UNIQUE INDEX uq_time_entries_open ON time_entries (user_id) WHERE end_at IS NULL AND is_deleted = 0;
CREATE INDEX ix_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX ix_work_schedules_user_id ON work_schedules (user_id);
CREATE INDEX ix_attachments_absence_id ON attachments (absence_id);
CREATE INDEX ix_work_logs_project_id ON work_logs (project_id);
CREATE INDEX ix_work_logs_user_date ON work_logs (user_id, date);
`

/** Alembic 0002: users.time_format. */
export const V1_MIGRATION_0002 = `ALTER TABLE users ADD COLUMN time_format VARCHAR(3) DEFAULT '24h' NOT NULL;`
