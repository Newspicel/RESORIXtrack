# Canton holiday presets with optional days and a canton map

Status: implemented, 2026-11-07

## Goal

Companies anywhere in Switzerland pick the right holiday calendar fast: choose a canton (list or map), tick the optional days the company gives, done. Keeping it right per work location stays the admin's job.

## Constraints

- Canton level only. All holiday data comes from `date-holidays`; RESORIXtrack maintains no holiday data of its own.
- No map library and no new runtime dependency. The map is one static, committed SVG.
- Signed-off months stay immutable. Every UI string in en, de, fr, it.

## Current state

- A preset is a canton key (`CH-ZH`) or the local preset `ch-fr-fribourg`. `presetHolidays` keeps only days `date-holidays` marks `public` and drops Sunday-only feasts.
- `ch-fr-fribourg` yields exactly the same dates as `CH-FR` (checked for 2026, 2027, 2031). It is the only hand-maintained holiday data.
- Optional days (`type: "optional"`) are dropped today. Commune-dependent days (FR, SO: `note` "excluding communities: ...") are included as public.
- Callers of presets: first-run setup (`setup.ts`), `install-holidays` CLI, the import sheet (one year into an existing calendar), the 1 October top-up (`topUpHolidays`), the demo seed, the v1 import.

## Design

### Selectable days

For a canton and year, `presetHolidays` splits days into:

- **statutory**: `public`, not Sunday-only, no commune note. Always included.
- **selectable**: `optional` days, and `public` days with a commune note. Each carries `kind: "optional" | "commune"`, the date-holidays note (communes) and `fraction` (0.5 when the day starts after midnight, e.g. Knabenschiessen from 13:00).

A selectable day is identified by its canonical English name (existing `CANONICAL` map), stable across years.

Selectable days in 2026: ZH Berchtold's Day, Knabenschiessen (half); LU, OW, NW, ZG, SO, FR Easter Monday, Whit Monday and others; FR Corpus Christi, Assumption, All Saints' Day, Immaculate Conception (commune); SO Saint Joseph (commune); GR Good Friday; NE Monday after Federal Day. The list is whatever `date-holidays` returns, never hard-coded.

### Storage

New column `holiday_calendars.preset_days`: `text({ mode: "json" }).$type<string[]>()`, not null, default `[]`. Holds the ticked selectable day names. A zod schema validates it on every write path; unknown names are rejected with a field error.

`presetHolidays(key, year, presetDays)` returns statutory days plus the ticked selectable days. Every caller passes the calendar's `preset_days`, so the top-up keeps adding them each year.

### Defaults

When a canton is picked, commune days are ticked (they apply in most of the canton), optional days are not (the law does not require them).

### Changing the ticks later

The calendar settings form shows the same checklist when the calendar has a preset. On save, for each year the calendar already covers from this year on:

- a newly ticked day is added,
- an unticked day is removed if its date is a preset date with that name,

but only for dates from today on and after the latest signed-off date (`latestSignedDate`), so past target time never changes. Signed-off dates are never touched. Holidays the admin added or renamed by hand are left alone (a removal matches on preset date and name).

Every holiday create, update and delete is a `revisions` row (entity `holiday`), shown in the audit log.

### Removing the City of Fribourg preset

- `LOCAL_PRESETS` and the `ch-fr-fribourg` key are deleted.
- Migration `0007_canton_presets.sql`: adds `preset_days`; rewrites `region_code = 'ch-fr-fribourg'` to `CH-FR` with the four FR commune days ticked (same dates as before, no holiday rows change).
- Demo seed and v1 import use `CH-FR` with the commune days ticked. The v1 import maps the old name "CH-FR City of Fribourg" to `CH-FR`.
- e2e expectations that name "CH-FR City of Fribourg" use the canton calendar's name.

### Canton map

- `src/components/app/canton-map.tsx`: one inline SVG, 26 `<path>`s keyed by canton code, generated once from swisstopo swissBOUNDARIES3D (canton level, LV95 coordinates are planar, so a plain scale fits them into the viewBox; simplified to about 20 to 30 KB). A short header comment names the source edition and the one-off command used. The generator is not kept in the repo and adds no dependency.
- Props: `value: string | null`, `onSelect(code)`. Hover and selection use theme tokens only (`fill-muted`, `fill-primary`, `stroke-border`).
- Accessibility: the combobox stays the accessible control. The map is a pointer shortcut, `aria-hidden`, not focusable.
- Shown beside the canton combobox in the preset form and in first-run setup, kept in sync. Hidden below the `sm` breakpoint.
- Attribution "Source: swisstopo" in `docs/third-party-licenses.md` and the licence check data.

### UI

Preset picker (calendar sheet for new and existing calendars, first-run setup, import sheet). The calendar sheet is one form: name, canton or none, checklist, description, default. Saving a new calendar with a canton installs this year and next.

1. Canton combobox plus map.
2. Statutory days as a read-only list.
3. Checklist of selectable days with date and, for commune days, the note ("not in: Murten, ...").

All strings in four languages. Day names are already translated in the UI.

### API and services

- `createCalendarFromPreset(key, { years, makeDefault, presetDays })`.
- `holidayCatalog` returns, per canton, the selectable days of the current year (name, kind, fraction, note), so the form needs no extra request.
- `saveCalendar` accepts `presetDays` and applies the add/remove rule above in the same transaction.
- REST and CLI: `install-holidays --days "Easter Monday,Whit Monday"`; REST calendar schema exposes `presetDays`.

## Testing

- Services: selectable split per canton; ticked days added on create and top-up; untick removes only unsigned preset dates; dates in a signed-off month stay unchanged on tick and untick; unknown day name rejected; non-admin denied.
- Migration: `ch-fr-fribourg` calendar becomes `CH-FR` with identical holiday rows.
- e2e: create a calendar from a canton via the map, tick Easter Monday, see it in the list; untick in settings, it disappears from the next year.

## Out of scope

Commune-level presets, any hand-maintained holiday data, a commune map.
