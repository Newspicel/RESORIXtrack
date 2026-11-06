# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Timezone helpers. Storage is UTC; days are evaluated in the user's local timezone."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

DEFAULT_TZ = "Europe/Zurich"


_FROZEN: datetime | None = None


def utcnow() -> datetime:
    return _FROZEN if _FROZEN is not None else datetime.now(UTC)


def freeze(dt: datetime | None) -> None:
    """Test helper: pin the clock used by all services (``None`` to release)."""
    global _FROZEN
    _FROZEN = dt.astimezone(UTC) if dt is not None else None


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def is_valid_tz(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return False


def all_timezones() -> list[str]:
    return sorted(available_timezones())


def local_today(tz: str) -> date:
    return utcnow().astimezone(zone(tz)).date()


def day_bounds_utc(d: date, tz: str) -> tuple[datetime, datetime]:
    """[start, end) of local calendar day ``d`` as UTC datetimes (handles 23h/25h DST days)."""
    z = zone(tz)
    start = datetime.combine(d, time.min, tzinfo=z).astimezone(UTC)
    end = datetime.combine(d + timedelta(days=1), time.min, tzinfo=z).astimezone(UTC)
    return start, end


def range_bounds_utc(start: date, end: date, tz: str) -> tuple[datetime, datetime]:
    """[start of ``start``, end of ``end``] (inclusive day range) in UTC."""
    return day_bounds_utc(start, tz)[0], day_bounds_utc(end, tz)[1]


def daterange(start: date, end: date) -> Iterator[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def minutes_between(a: datetime, b: datetime) -> float:
    return max(0.0, (b - a).total_seconds() / 60.0)


def ensure_aware(dt: datetime, tz: str | None = None) -> datetime:
    """Interpret naive datetimes in ``tz`` (user's zone); return UTC-aware."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zone(tz))
    return dt.astimezone(UTC)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return start, nxt - timedelta(days=1)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z") if dt else None
