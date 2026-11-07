# Administrator guide

For the people with the *Administrator* role. It walks you through setting up the company once, then explains each administration page. Day-to-day use (clocking, absences, approvals) is in the [user manual](user-manual.md); installing the software is in [installation.md](installation.md).

## Setting up your company, step by step

After the setup wizard, the dashboard shows a **Getting started** checklist that tracks these steps and links to the right pages. Hide it when you are done.

### 1. Check the working-time rules

**Administration → Settings → Working time**

- **Public holidays**: *Scheduled days* (default) reduces the target only when a holiday falls on a person's working day – simple and what most Swiss companies do. *Pro rata* credits every Monday–Friday holiday in proportion to the employment level, even on a part-timer's day off.
- **Full-time weekly hours** (e.g. 42:00): the basis for new work schedules and pro-rata holidays.
- **Vacation days per year for new employees**: proposed when you add someone.
- **Pro-rate vacation days by scheduled days per week**: off by default, meaning the days entered per person are *their* days (enter 15 for someone working three days a week). Switch it on if you prefer to enter full-time values everywhere and let RESORIXtrack scale them by each person's scheduled days per week (25 → 15 for a Mon–Wed schedule; a five-day 60 % schedule keeps 25 because each vacation day is a short day).
- **Bonus for work on public holidays** in percent, if your rules grant one.
- **Working time law**: warnings (never blocks) for breaks that are too short and for a weekly maximum.
- **Changes and reminders**: whether employees must give a reason when editing past days (recommended), and after how many hours of continuous clocking an email reminder is sent.
- **Sick reports**: how many days back employees may report themselves sick, and the maximum length of a self-report.
- **Work log**: *Off*, *Optional* or *Required*. People describe what they did while clocked in – free text, a project, or both. With *Required*, set the **share of the worked time** that must be described per day (e.g. 80 %): days below it are flagged, the person is reminded after clocking out, and the month can't be signed off until the gap is closed. *Every item needs a project* additionally forces a project per item (free text stays possible on top).

Save once, even without changes, to tick the checklist item. Changing these rules later recalculates all months, including signed-off ones; the signed PDF statements keep the figures that were valid at sign-off.

### 2. Connect email

Email is configured in the server's `.env` file (see [installation.md](installation.md#email-smtp)). **Settings → Email** shows the current configuration and sends a test email. Without email, you can still add employees and set their passwords manually.

### 3. Holiday calendars

**Administration → Holiday calendars**

RESORIXtrack ships with presets (City of Fribourg 2026–2029, more Swiss cantons as they are added). If your region isn't covered:

1. Create a calendar (e.g. "Zurich") and make it the company default.
2. **Import** the statutory holidays of your country and canton/state for the current and the next year. Importing again later only adds missing dates. Optionally add 24 and 31 December as afternoon half-days.
3. Add or edit single holidays by hand; half-day holidays always cover the afternoon.

Calendars apply in this order: **employee → team → company default**. Assign a different calendar to a team or a person who works in another canton.

### 3b. Projects (if the work log is on)

**Team → Projects**: company-wide projects (available to everyone) are created by administrators; team leads create and manage the projects of their own teams. Give each project a code for reports (letters or numbers, up to 30 characters) and deactivate it when it is finished. Employees can also type a free-text **customer reference** (for example a customer number) instead of picking a project; the projects report groups those by reference. The list is searchable by name, code and team, so it stays usable with hundreds of projects.

### 3c. Roles: who sees what

As an administrator you manage people, teams, settings and backups – but you see **no working times** of others. (The administrator created by the setup wizard starts with the HR and Projects capabilities so a small company can begin right away; remove them once other people take over.) Time data is visible to team leads (their members) and to people with the **HR capability** (everyone). Grant HR under **Employees → Edit → Capabilities** to whoever signs off months, runs company reports or answers data-access requests – that can be yourself. The **Projects** capability lets a person create and maintain all projects. Both appear as badges in the employee list.

### 4. Teams

**Administration → Teams**

Create a team for each group that has its own lead. **Team leads** approve vacation, record absences, correct entries, sign off months and manage team projects for the members. A team can have **several leads**, and **deputies** ("Stellvertreter") – with a period (e.g. a lead's vacation) or open-ended – who have the same powers while the period is current. Leads can also name deputies for their own team themselves (Team overview). A team without a lead works too: its requests go to HR (or to the administrators if nobody holds HR). A lead doesn't have to be a member of the team they lead, and can lead several teams.

### 5. Employees

**Administration → Employees → Invite employee**

For each person:

- Name, email, role (*Employee* or *Administrator*), team.
- Language and timezone (defaults come from Settings → General; each person can change their own later).
- **Employment start**: target hours and vacation are counted from this day. Opening balance from a previous system, if any.
- **Vacation days per year** – either the person's own days (default) or a full-time value that RESORIXtrack scales by their scheduled days per week, depending on Settings → Working time.
- **Employment level** and the **weekly work schedule** (minutes per weekday). The schedule is versioned: a later contract change adds a new version from a date, and past months keep their old targets.
- **Send invitation**: the person receives an email with a link (valid 72 hours) to choose language, timezone and password. Without email, save first and then use **Edit → Set password** and pass the password on in person.

Administrators are employees too: they have their own time account, schedule and vacation.

### 6. Branding

**Settings → Branding**: company name, accent colour and two logos (for dark and light backgrounds; SVG or PNG, up to 512 KB). Logos appear on the sign-in page, in the app, on PDF reports and – PNG only – in emails. Details in [customizing.md](customizing.md).

### 7. Backups

An encrypted backup is written every night. Download one from **Administration → Backups & logs** and set up an off-site copy as described in [backup-restore.md](backup-restore.md). Every backup is encrypted with the `BACKUP_PASSWORD` of the server – keep it in your password manager, without it no backup can be restored.

## Month-end routine

1. In the first days of a month, ask team leads to open **Team → Month sign-off** for the previous month.
2. The page lists every member with target, worked hours and difference, and flags what prevents a sign-off: a clock still running, open absence requests, the month not being over.
3. Signing off locks the person's month for everyone – time entries, absences, adjustments and work-log items. The person is notified; the timesheet PDF then shows *Signed off by … · seal …*.
4. HR signs off team leads and people without a lead, and can sign off everyone at once (choose *All teams*, *Select all*). Nobody signs off their own month.
5. To correct something afterwards, HR **reopens** the month with a reason (logged, notified), the correction is made, and the month is signed off again.

The **integrity check** on the same page (administrators and HR) verifies that no signed month was changed outside RESORIXtrack and that no rule change altered its figures.

## The administration pages

### Employees

<p><img src="screenshots/admin-dark-admin_users.png" alt="Employees" width="760"></p>

- Search and filter by team; show inactive accounts.
- **Edit**: profile, role and capabilities (HR, Projects), employment dates, vacation entitlement per year (override for a single year), work-schedule versions, set password, resend invitation, send a password-reset link.
- **Deactivate** when someone leaves: they are signed out everywhere, a running clock is stopped, API tokens are revoked, pending requests disappear from inboxes. Data is kept; the account can be reactivated. If the person led a team, the team is left without a lead – assign a new one.
- **Reset two-factor** when a person lost their phone and recovery codes (your password is required; logged).
- **Export data (JSON)** for data-access requests: everything stored about the person in one file (requires the HR capability, because it contains time data).
- **Anonymise…** (inactive accounts only, your password required, irreversible): name and email become placeholders, documents are deleted, logs, sessions and tokens are removed, the name is scrubbed from the change history. Working-time records stay for the statutory retention period. From the console, `flask resorixtrack anonymize --email …` additionally enforces a retention period (5 years by default).
- **Offboarding checklist**: set the *employment end* date (the clock stops working after it), sign off the last month, pay out or settle the balance (Time account → Adjust balance), download the final timesheet, deactivate; after the retention period, anonymise.

### Teams

<p><img src="screenshots/admin-dark-admin_teams.png" alt="Teams with leads and deputies" width="760"></p>

Name, colour, leads and deputies with their periods, holiday calendar, members. Moving a member to another team takes effect immediately; history stays with the person. Deactivating a person removes them as lead or deputy.

### Holiday calendars

<p><img src="screenshots/admin-dark-admin_holidays.png" alt="Public-holiday calendars" width="760"></p>

See step 3 above. Deleting a calendar that is in use makes teams and people fall back to the next calendar in the order. Every employee sees the calendar that applies to them under *Public holidays* in the main menu, read-only.

### Settings

<p><img src="screenshots/admin-dark-admin_settings.png" alt="Settings" width="760"></p>

- **General**: defaults for new employees, security (session length, sign-in log retention), two-factor authentication (required for administrators or for everyone) (require it for administrators), team-lead permissions (may they change schedules and adjust balances?).
- **Branding**: see step 6.
- **Working time**: see step 1.
- **Absence types**: which absences employees can request themselves, which need approval, which allow documents, whether they reduce target hours (vacation, sickness, training…) or use up the balance (time off in lieu), and whether they deduct vacation days. Built-in types are translated; you can add your own (e.g. "Moving day").
- **Email**: SMTP status and test email.

### Backups & logs

<p><img src="screenshots/admin-dark-admin_backups.png" alt="Encrypted backups" width="760"></p>

- **Backups**: create, download, delete – all archives are encrypted with the server's backup password. See [backup-restore.md](backup-restore.md).
- **Audit log**: every change to time entries, absences, balances, schedules, employee data and sign-offs – who, when, before/after, why. Filter by person, record type and period.
- **Sign-in log**: every sign-in attempt with result, device and IP, including the first use per day of each API token. Unknown addresses are masked. Retention is set under Settings → General.
- **API tokens**: every personal access token in the company with owner, permissions, expiry, last use (time and IP) and call count. Revoke a token here when a laptop is lost or someone leaves a project; the owner is notified and the revocation is logged. *Settings → General* can switch personal tokens off entirely.

### Reports

Available to administrators for everyone and to team leads for their teams: monthly **timesheet** (PDF to sign), **balances** per person, **absences** overview, and the raw **time entries** export (including edited and deleted ones). Formats: PDF, XLSX, CSV. Former employees stay in the reports of the months they worked.

## Server-side commands

Run inside the container: `docker compose exec app flask resorixtrack <command>`.

| Command | Purpose |
|---|---|
| `setup-code` | Print a fresh one-time code for the setup wizard (only while no account exists) |
| `create-admin --email … --name …` | Create an administrator from the console |
| `set-password --email …` | Set a user's password (e.g. without email); signs them out everywhere |
| `anonymize --email … [--retention-days 1825] [--force]` | Anonymise a deactivated former employee after the retention period |
| `install-holidays --preset ch-fr-fribourg` | Install a built-in holiday calendar |
| `backup`, `restore <file.zip.enc>`, `decrypt-backup` | Encrypted backups from the console (see backup-restore.md) |
| `purge-attachments --older-than 365` | Delete files of removed documents and of documents on cancelled/declined absences |
| `migrate` | Apply pending database migrations (runs automatically on start) |
| `send-reminders` | Send clock-out reminders now (the worker does this automatically) |

## Frequently asked questions

**An employee's balance is far off.** Check the employment start (target hours count from that day), the schedule versions (is there a gap?), the holiday calendar assigned, and manual adjustments on the person's time account.

**Someone forgot to clock out yesterday.** The dashboard shows a warning; they (or you) clock out and then correct the end time of the entry under My time, with a reason. The reminder email after N hours is configurable.

**Can I change a signed-off month?** Only after reopening it (administrators), which is logged and notified.

**How do I give someone API access for a desktop app?** They create a token themselves under Profile & security (Profile & security → API tokens) with the scopes they need. See [api.md](api.md).

**We have no email server.** Set passwords manually (Employees → Edit → Set password) and tell people to contact you if they forget them; the forgot-password page says so automatically.
