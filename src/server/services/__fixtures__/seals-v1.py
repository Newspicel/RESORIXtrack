"""Generates seals-v1.json: sign-off digests and seals computed exactly like RESORIXtrack 1.x
(backend/resorixtrack/services/signoffs.py: period_data, compute_digest, compute_seal), stdlib only.

    python3 -I src/server/services/__fixtures__/seals-v1.py > src/server/services/__fixtures__/seals-v1.json
"""
import hashlib
import hmac
import json
from datetime import date, datetime, time, timezone
from types import SimpleNamespace as NS

KEY = "dev-insecure-secret-key-change-me-0123456789"
UTC = timezone.utc


def _key() -> bytes:
    return hashlib.sha256(("resorixtrack-signoff:" + KEY).encode()).digest()


def _ts(v):
    return v.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f") if v else None


def dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def inst(v):
    return v.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ") if v else None


USER = 7
ENTRIES = [
    NS(id=11, kind="work", start_at=dt("2026-09-30T21:30:00.000000Z"), end_at=dt("2026-09-30T22:30:00.000000Z"), is_deleted=False, note="night shift"),
    NS(id=12, kind="work", start_at=dt("2026-10-14T06:00:00.123456Z"), end_at=dt("2026-10-14T10:00:00.000001Z"), is_deleted=False, note="Kundenbesuch Zürich – “Ost” \U0001F600"),
    NS(id=13, kind="break", start_at=dt("2026-10-14T10:00:00.000000Z"), end_at=dt("2026-10-14T10:30:00.000000Z"), is_deleted=False, note='quote " backslash \\ tab\t nl\n del\x7f ctl\x01'),
    NS(id=14, kind="work", start_at=dt("2026-10-15T06:00:00.000000Z"), end_at=dt("2026-10-15T07:00:00.000000Z"), is_deleted=True, note=""),
    NS(id=15, kind="work", start_at=dt("2026-09-10T06:00:00.000000Z"), end_at=dt("2026-09-10T15:00:00.000000Z"), is_deleted=False, note="Sept"),
    NS(id=16, kind="work", start_at=dt("2026-10-31T22:30:00.000000Z"), end_at=None, is_deleted=False, note="running at the edge"),
]
ABSENCES = [
    NS(id=21, type_id=1, start_date=date(2026, 10, 19), end_date=date(2026, 10, 20), start_half="pm", end_half="am", status="approved"),
    NS(id=22, type_id=2, start_date=date(2026, 9, 29), end_date=date(2026, 10, 2), start_half="full", end_half="full", status="cancelled"),
    NS(id=23, type_id=1, start_date=date(2026, 10, 30), end_date=date(2026, 10, 30), start_half="am", end_half="full", status="approved"),
]
ADJUSTMENTS = [
    NS(id=31, account="vacation", amount=1.0, effective_date=date(2026, 10, 1), is_deleted=False),
    NS(id=32, account="vacation", amount=0.5, effective_date=date(2026, 10, 2), is_deleted=False),
    NS(id=33, account="time", amount=-30.0, effective_date=date(2026, 10, 3), is_deleted=True),
    NS(id=34, account="time", amount=0.1 + 0.2, effective_date=date(2026, 10, 4), is_deleted=False),
    NS(id=35, account="time", amount=1e-05, effective_date=date(2026, 10, 5), is_deleted=False),
    NS(id=36, account="time", amount=1e16, effective_date=date(2026, 10, 6), is_deleted=False),
    NS(id=37, account="time", amount=123456.789, effective_date=date(2026, 10, 7), is_deleted=False),
    NS(id=38, account="time", amount=-0.25, effective_date=date(2026, 9, 7), is_deleted=False),
]
WORK_LOGS = [
    NS(id=41, date=date(2026, 10, 14), project_id=5, customer_ref="", minutes=240, note="Planung", is_deleted=False, start_time=time(8, 0), end_time=time(12, 0)),
    NS(id=42, date=date(2026, 10, 15), project_id=None, customer_ref="ACME Genève", minutes=30, note="", is_deleted=True, start_time=None, end_time=None),
    NS(id=43, date=date(2026, 9, 10), project_id=None, customer_ref="", minutes=60, note="Sept", is_deleted=False, start_time=None, end_time=None),
]


def period_data(start_date, end_date, start_utc, end_utc):
    entries = sorted((e for e in ENTRIES if e.start_at < end_utc and (e.end_at is None or e.end_at > start_utc)), key=lambda e: e.id)
    absences = sorted((a for a in ABSENCES if a.start_date <= end_date and a.end_date >= start_date), key=lambda a: a.id)
    adjustments = sorted((a for a in ADJUSTMENTS if start_date <= a.effective_date <= end_date), key=lambda a: a.id)
    logs = sorted((w for w in WORK_LOGS if start_date <= w.date <= end_date), key=lambda w: w.id)
    return {
        "work_logs": [[w.id, w.date.isoformat(), w.project_id, w.customer_ref, int(w.minutes), w.note, bool(w.is_deleted),
                       w.start_time.strftime("%H:%M") if w.start_time else None, w.end_time.strftime("%H:%M") if w.end_time else None] for w in logs],
        "entries": [[e.id, e.kind, _ts(e.start_at), _ts(e.end_at), bool(e.is_deleted), e.note] for e in entries],
        "absences": [[a.id, a.type_id, a.start_date.isoformat(), a.end_date.isoformat(), a.start_half,
                      a.end_half, a.status] for a in absences],
        "adjustments": [[a.id, a.account, float(a.amount), a.effective_date.isoformat(), bool(a.is_deleted)]
                        for a in adjustments],
    }


def compute_digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def seal_payload(row):
    return {
        "user_id": row.user_id, "month": row.month, "start": row.period_start_date.isoformat(),
        "end": row.period_end_date.isoformat(), "start_utc": _ts(row.period_start_utc),
        "end_utc": _ts(row.period_end_utc), "signed_by": row.signed_by_id, "signed_at": _ts(row.signed_at),
        "snapshot": row.snapshot, "digest": row.digest, "prev": row.prev_seal,
    }


def compute_seal(row):
    msg = json.dumps(seal_payload(row), sort_keys=True, separators=(",", ":"), default=str).encode()
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()


SNAPSHOT = {"scheduled_min": 10584.0, "target_min": 10080.0, "target_total_min": 10584.0, "worked_min": 270.0,
            "credit_min": 756.5, "delta_min": -9053.5, "vacation_days": 1.5, "workdays": 21,
            "balance_end_min": -9053.25, "timezone": "Europe/Zurich", "user_name": "Zoë Müller-Łukasiewicz",
            "signed_by_name": "Lea Lead “TL”", "extra": None, "big": 1e16, "tiny": 1e-05}

SIGNOFFS = [
    dict(id=101, month="2026-09", start=date(2026, 9, 1), end=date(2026, 9, 30), s_utc="2026-08-31T22:00:00Z",
         e_utc="2026-09-30T22:00:00Z", signed_by=3, signed_at="2026-10-02T08:15:00Z", snapshot={**SNAPSHOT, "workdays": 22},
         reopened_at="2026-10-03T09:00:00.654321Z"),
    dict(id=102, month="2026-09", start=date(2026, 9, 1), end=date(2026, 9, 30), s_utc="2026-08-31T22:00:00Z",
         e_utc="2026-09-30T22:00:00Z", signed_by=None, signed_at="2026-10-04T08:15:00Z", snapshot={}, reopened_at=None),
    dict(id=103, month="2026-10", start=date(2026, 10, 1), end=date(2026, 10, 31), s_utc="2026-09-30T22:00:00Z",
         e_utc="2026-10-31T23:00:00Z", signed_by=3, signed_at="2026-11-02T07:00:00Z", snapshot=SNAPSHOT, reopened_at=None),
]

out_signoffs = []
prev = ""
for s in SIGNOFFS:
    s_utc, e_utc = dt(s["s_utc"]), dt(s["e_utc"])
    data = period_data(s["start"], s["end"], s_utc, e_utc)
    row = NS(user_id=USER, month=s["month"], period_start_date=s["start"], period_end_date=s["end"],
             period_start_utc=s_utc, period_end_utc=e_utc, signed_by_id=s["signed_by"], signed_at=dt(s["signed_at"]),
             snapshot=s["snapshot"], digest=compute_digest(data), prev_seal=prev)
    row.seal = compute_seal(row)
    out_signoffs.append({
        "id": s["id"], "month": s["month"], "periodStartDate": s["start"].isoformat(), "periodEndDate": s["end"].isoformat(),
        "periodStartUtc": inst(s_utc), "periodEndUtc": inst(e_utc), "signedById": s["signed_by"], "signedAt": inst(row.signed_at),
        # what SQLAlchemy's JSON column wrote into month_signoffs.snapshot (json.dumps defaults)
        "snapshot": json.dumps(s["snapshot"]), "digest": row.digest, "prevSeal": prev, "seal": row.seal,
        "reopenedAt": s["reopened_at"],
        "canonicalData": json.dumps(data, sort_keys=True, separators=(",", ":")),
        "canonicalSeal": json.dumps(seal_payload(row), sort_keys=True, separators=(",", ":"), default=str),
    })
    prev = row.seal

print(json.dumps({
    "key": KEY,
    "userId": USER,
    "entries": [{"id": e.id, "kind": e.kind, "startAt": inst(e.start_at), "endAt": inst(e.end_at), "isDeleted": e.is_deleted, "note": e.note} for e in ENTRIES],
    "absences": [{"id": a.id, "typeId": a.type_id, "startDate": a.start_date.isoformat(), "endDate": a.end_date.isoformat(), "startHalf": a.start_half, "endHalf": a.end_half, "status": a.status} for a in ABSENCES],
    "adjustments": [{"id": a.id, "account": a.account, "amount": a.amount, "effectiveDate": a.effective_date.isoformat(), "isDeleted": a.is_deleted} for a in ADJUSTMENTS],
    "workLogs": [{"id": w.id, "date": w.date.isoformat(), "projectId": w.project_id, "customerRef": w.customer_ref, "minutes": w.minutes, "note": w.note, "isDeleted": w.is_deleted, "startTime": w.start_time.strftime("%H:%M") if w.start_time else None, "endTime": w.end_time.strftime("%H:%M") if w.end_time else None} for w in WORK_LOGS],
    "signoffs": out_signoffs,
}, indent=1, ensure_ascii=False))
