# Customizing

## Logo and colours (no rebuild)

**Administration → Settings → Branding**

- **Company name**: shown in the browser title, emails, reports.
- **Accent colour**: one colour (`#rrggbb`) for buttons, links and highlights. Lighter and darker shades are derived automatically. Leave empty for the default blue.
- **Logos**: one for dark backgrounds (light artwork) and one for light backgrounds. SVG or PNG, up to 512 KB, transparent background, at least 64 px tall. They are used on the sign-in page, in the sidebar, on PDF reports and – **PNG only**, because mail clients don't render SVG – in emails. If you upload only SVG, emails show the company name as text instead.

Uploaded files live in `/data/branding/` (inside the Docker volume) and are included in backups. Uploaded SVG is checked for scripts, event handlers and external references and refused if it contains any.

## Theme (one file)

Everything visual that isn't the logo is defined as CSS custom properties in **`frontend/src/styles/theme.css`**: background and surface colours for the dark and the light theme, the brand/accent colours, the semantic colours (work, break, absence, holiday, positive/negative balance, danger), border radii, shadows, fonts and layout sizes (sidebar width, top bar height).

```css
:root {
  --color-brand: #35a1cc;          /* primary buttons, active states, links */
  --color-brand-bright: #61cae2;   /* lighter accent for dark backgrounds */
  --color-brand-ink: #207aaa;      /* darker accent for light backgrounds / hover */
  --color-break: #e0a23b;
  --radius-lg: 14px;
  --sidebar-w: 248px;
  ...
}
:root[data-theme="light"] { ... }
```

Change the values, rebuild (`make build-frontend` for a local check, `docker compose up -d --build` for production). The accent colour set in Branding overrides the three `--color-brand*` values at runtime, so operators can change it without a rebuild.

Component styles are in `frontend/src/styles/global.css` (app shell, cards, buttons, forms, tables, calendar, timeline) and `admin.css` (administration pages). They only reference the tokens from `theme.css`.

## Favicon and app icon

`frontend/public/favicon.svg` and `frontend/public/apple-touch-icon.png`, plus `manifest.webmanifest` for the installable app. Replace the files and rebuild.

## Languages

The UI ships in English, German and French. To add a language:

1. Copy `frontend/src/i18n/en/` to `frontend/src/i18n/<code>/` and translate the JSON files. Keep the keys and the `{placeholders}`; plural forms use `_one` / `_other` suffixes (`_few`/`_many` where the language needs them).
2. Add the language to `LOCALES` in `frontend/src/lib/i18n.ts` (code, label, Intl locale for date and number formatting).
3. Add `<code>` to the allowed locales in `backend/resorixtrack/api/schemas.py` and `backend/resorixtrack/services/users.py`.
4. Optional but recommended: email templates in `backend/resorixtrack/templates/email/<code>/` (one text file per message, same structure as `en/`), and the PDF/XLSX labels (`LABELS`, `HOLIDAY_NAMES_*` in `backend/resorixtrack/services/reports.py`, `ABSENCE_LABELS_*` in `services/mail.py`). English is the fallback for anything missing.
5. Run `node frontend/scripts/i18n-check.mjs`: it lists missing keys and placeholder mismatches.

Holiday names are stored in English as data and translated for display through `i18n/<code>/holidays.json`.

## Email templates

`backend/resorixtrack/templates/email/<locale>/<message>.txt`: plain-text Jinja templates with a `{% set subject = "…" %}` line and optional `cta_url` / `cta_label`. The HTML version is generated from the paragraphs inside the branded layout `templates/email/base.html` (colours and footer can be edited there).

## PDF reports

`backend/resorixtrack/templates/pdf/_base.html` holds the page layout and styles of all PDF reports (A4, header with logo, footer with page numbers); the individual reports are `timesheet.html`, `balances.html`, `absences.html`.

## Public-holiday presets

Built-in calendars are defined in `backend/resorixtrack/services/presets.py`. Add a preset with a key, name, region code and the list of `(date, name, fraction)` entries; it then appears in the setup wizard and under Public holidays → Install preset.

## Absence types

Custom absence types don't need code: **Settings → Absence types → New absence type**. Built-in types can be renamed per language through `i18n/<code>/absence_types.json`.
