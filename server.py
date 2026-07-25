#!/usr/bin/env python3
"""TimeClock backend — stdlib only (sqlite3 + http.server)."""

import base64
import ftplib
import json
import os
import re
import socket
import sqlite3
import ssl
import sys
import threading
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse, urlsplit, urlunsplit

PORT = int(os.environ.get("PORT", 3000))
DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent / "timeclock.db"))
PUBLIC = Path(__file__).parent / "public"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif":  "image/gif",
}

UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", str(Path(__file__).parent / "uploads")))


# ── Database setup ─────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS pay_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rate REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER,
            client_id INTEGER,
            pay_rate_id INTEGER,
            rate_type TEXT DEFAULT 'hourly',
            flat_amount REAL,
            clock_in TEXT NOT NULL,
            clock_out TEXT,
            est_minutes INTEGER,
            calendar_uid TEXT,
            calendar_seq INTEGER DEFAULT 0,
            address TEXT,
            latitude REAL,
            longitude REAL,
            site_id TEXT,
            assignment_id TEXT,
            ticket_num TEXT,
            inc_num TEXT,
            mod_name TEXT,
            noc_name TEXT,
            pm_pc_name TEXT,
            parking_tolls TEXT,
            is_replacement INTEGER DEFAULT 0,
            old_serial TEXT,
            new_serial TEXT,
            return_track TEXT,
            no_return_track INTEGER DEFAULT 0,
            work_summary TEXT,
            additional_info TEXT,
            wo_title TEXT,
            travel_reimb REAL,
            revisit_required INTEGER DEFAULT 0,
            received_pay REAL,
            status TEXT DEFAULT 'pending',
            release_code TEXT,
            no_release_code INTEGER DEFAULT 0,
            materials TEXT,
            pay_adjustment REAL,
            pay_adjustment_note TEXT,
            received_date TEXT,
            project_id INTEGER,
            revisit_of INTEGER,
            custom_photo_fields TEXT,
            scope_of_work TEXT,
            dispatch_contacts TEXT,
            pre_clockout TEXT,
            comment TEXT,
            total_break_seconds INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id),
            FOREIGN KEY (client_id) REFERENCES clients(id),
            FOREIGN KEY (pay_rate_id) REFERENCES pay_rates(id)
        );
        CREATE TABLE IF NOT EXISTS breaks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            break_start TEXT NOT NULL,
            break_end TEXT,
            FOREIGN KEY (entry_id) REFERENCES time_entries(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS entry_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            photo_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            folder TEXT,
            original_name TEXT,
            ftp_synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (entry_id) REFERENCES time_entries(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS pay_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start TEXT NOT NULL UNIQUE,
            week_end TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            expected_total REAL DEFAULT 0,
            received_amount REAL,
            notes TEXT,
            paid_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            assignment_id TEXT,
            trip_id TEXT,
            folder TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            mileage_start REAL,
            mileage_end REAL,
            distance REAL,
            tax_deduction REAL,
            notes TEXT,
            status TEXT DEFAULT 'active',
            total_pause_seconds INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trip_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trip_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            photo_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            folder TEXT,
            original_name TEXT,
            ftp_synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS trip_pauses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            pause_start TEXT NOT NULL,
            pause_end TEXT,
            FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            defaults TEXT,
            archived INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS planned_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wo_title TEXT,
            organization_id INTEGER,
            client_id INTEGER,
            project_id INTEGER,
            assignment_id TEXT,
            site_id TEXT,
            address TEXT,
            rate_type TEXT DEFAULT 'hourly',
            pay_rate_id INTEGER,
            flat_amount REAL,
            travel_reimb REAL,
            notes TEXT,
            planned_date TEXT,
            planned_time TEXT,
            est_minutes INTEGER,
            revisit_of INTEGER,
            scope_of_work TEXT,
            dispatch_contacts TEXT,
            calendar_uid TEXT,
            calendar_seq INTEGER DEFAULT 0,
            ticket_num TEXT,
            inc_num TEXT,
            mod_name TEXT,
            noc_name TEXT,
            pm_pc_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('break_reminder_minutes', '120'),
            ('break_return_minutes', '10'),
            ('currency_symbol', '$'),
            ('week_start', '1'),
            ('tech_name', ''),
            ('breaks_enabled', '1'),
            ('paid_breaks', '0'),
            ('break_frequency_minutes', '120'),
            ('break_length_minutes', '15'),
            ('ftp_enabled', '0'),
            ('ftp_host', ''),
            ('ftp_port', '21'),
            ('ftp_user', ''),
            ('ftp_password', ''),
            ('ftp_path', '/timeclock/photos'),
            ('mileage_rate', '0.67'),
            ('caldav_enabled', '0'),
            ('caldav_url', ''),
            ('caldav_user', ''),
            ('caldav_password', ''),
            ('caldav_calendar', 'personal'),
            ('caldav_duration_min', '60'),
            ('caldav_sync_entries', '1');
        """)


def migrate_db():
    """Non-destructively add new columns to existing databases."""
    migrations = [
        "ALTER TABLE time_entries ADD COLUMN client_id INTEGER",
        "ALTER TABLE time_entries ADD COLUMN site_id TEXT",
        "ALTER TABLE time_entries ADD COLUMN rate_type TEXT DEFAULT 'hourly'",
        "ALTER TABLE time_entries ADD COLUMN flat_amount REAL",
        "ALTER TABLE time_entries ADD COLUMN assignment_id TEXT",
        "ALTER TABLE time_entries ADD COLUMN ticket_num TEXT",
        "ALTER TABLE time_entries ADD COLUMN inc_num TEXT",
        "ALTER TABLE time_entries ADD COLUMN mod_name TEXT",
        "ALTER TABLE time_entries ADD COLUMN noc_name TEXT",
        "ALTER TABLE time_entries ADD COLUMN pm_pc_name TEXT",
        "ALTER TABLE time_entries ADD COLUMN parking_tolls TEXT",
        "ALTER TABLE time_entries ADD COLUMN is_replacement INTEGER DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN old_serial TEXT",
        "ALTER TABLE time_entries ADD COLUMN new_serial TEXT",
        "ALTER TABLE time_entries ADD COLUMN return_track TEXT",
        "ALTER TABLE time_entries ADD COLUMN no_return_track INTEGER DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN work_summary TEXT",
        "ALTER TABLE time_entries ADD COLUMN additional_info TEXT",
        "ALTER TABLE time_entries ADD COLUMN status TEXT DEFAULT 'pending'",
        "ALTER TABLE time_entries ADD COLUMN release_code TEXT",
        "ALTER TABLE time_entries ADD COLUMN no_release_code INTEGER DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN materials TEXT",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('tech_name', '')",
        "ALTER TABLE time_entries ADD COLUMN wo_title TEXT",
        "ALTER TABLE time_entries ADD COLUMN travel_reimb REAL",
        "ALTER TABLE time_entries ADD COLUMN revisit_required INTEGER DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN received_pay REAL",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('breaks_enabled', '1')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('paid_breaks', '0')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('break_frequency_minutes', '120')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('break_length_minutes', '15')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_enabled', '0')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_host', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_port', '21')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_user', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_password', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ftp_path', '/timeclock/photos')",
        "ALTER TABLE entry_photos ADD COLUMN folder TEXT",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('mileage_rate', '0.67')",
        """CREATE TABLE IF NOT EXISTS trip_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            photo_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            folder TEXT,
            original_name TEXT,
            ftp_synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        )""",
        "ALTER TABLE trips ADD COLUMN total_pause_seconds INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN pay_adjustment REAL",
        "ALTER TABLE time_entries ADD COLUMN pay_adjustment_note TEXT",
        "ALTER TABLE time_entries ADD COLUMN received_date TEXT",
        "ALTER TABLE time_entries ADD COLUMN project_id INTEGER",
        "ALTER TABLE time_entries ADD COLUMN revisit_of INTEGER",
        "ALTER TABLE time_entries ADD COLUMN custom_photo_fields TEXT",
        "ALTER TABLE time_entries ADD COLUMN scope_of_work TEXT",
        "ALTER TABLE time_entries ADD COLUMN dispatch_contacts TEXT",
        "ALTER TABLE time_entries ADD COLUMN pre_clockout TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN scope_of_work TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN calendar_uid TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN calendar_seq INTEGER DEFAULT 0",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_enabled', '0')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_url', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_user', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_password', '')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_calendar', 'personal')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_duration_min', '60')",
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('caldav_sync_entries', '1')",
        "ALTER TABLE time_entries ADD COLUMN calendar_uid TEXT",
        "ALTER TABLE time_entries ADD COLUMN calendar_seq INTEGER DEFAULT 0",
        "ALTER TABLE time_entries ADD COLUMN est_minutes INTEGER",
        "ALTER TABLE planned_jobs ADD COLUMN est_minutes INTEGER",
        "ALTER TABLE planned_jobs ADD COLUMN dispatch_contacts TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN planned_date TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN planned_time TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN revisit_of INTEGER",
        "ALTER TABLE planned_jobs ADD COLUMN ticket_num TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN inc_num TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN mod_name TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN noc_name TEXT",
        "ALTER TABLE planned_jobs ADD COLUMN pm_pc_name TEXT",
        "ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            defaults TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )""",
        """CREATE TABLE IF NOT EXISTS planned_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wo_title TEXT,
            organization_id INTEGER,
            client_id INTEGER,
            project_id INTEGER,
            assignment_id TEXT,
            site_id TEXT,
            address TEXT,
            rate_type TEXT DEFAULT 'hourly',
            pay_rate_id INTEGER,
            flat_amount REAL,
            travel_reimb REAL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )""",
        """CREATE TABLE IF NOT EXISTS trip_pauses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    pause_start TEXT NOT NULL,
    pause_end TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
)""",
    ]
    with get_db() as db:
        for stmt in migrations:
            try:
                db.execute(stmt)
            except Exception:
                pass  # column or row already exists
    with get_db() as db:
        if db.execute("SELECT COUNT(*) FROM trip_categories").fetchone()[0] == 0:
            for i, name in enumerate(["In Route to WO","Returning Home","OffClock Tools/Supplies","OnClock Tools/Supplies","Other"]):
                db.execute("INSERT OR IGNORE INTO trip_categories (name, sort_order) VALUES (?,?)", (name, i))


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ── Nextcloud / CalDAV calendar sync ────────────────────────────────────────────
# Planned jobs are pushed to a CalDAV calendar as VEVENTs. Creating and updating
# is a plain HTTP PUT of an .ics body, deleting is a DELETE — no CalDAV client
# library needed. All calls are made from a background thread so the request
# that triggered them returns immediately.

CALDAV_KEYS = ("caldav_enabled", "caldav_url", "caldav_user", "caldav_password",
               "caldav_calendar", "caldav_duration_min", "caldav_sync_entries")

def caldav_settings(db=None):
    def read(conn):
        return {r["key"]: r["value"] for r in conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'caldav_%'").fetchall()}
    if db is not None:
        return read(db)
    with get_db() as conn:
        return read(conn)

def caldav_ready(s):
    return (s.get("caldav_enabled") == "1"
            and (s.get("caldav_url") or "").strip()
            and (s.get("caldav_user") or "").strip()
            and (s.get("caldav_password") or "").strip())

_PRIVATE_IP = re.compile(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)")

def caldav_normalize_url(raw):
    """Turn what a person types into a usable base URL. Returns (url, error).

    Accepts a bare host ('cloud.example.com', 'nextcloud:8080'), repairs the
    'https:/host' single-slash typo, and drops a trailing slash. A bare host
    gets https, except for addresses that can only be local — a container name,
    an IP, localhost — where plain http is what people actually run.
    """
    url = (raw or "").strip()
    if not url:
        return "", None
    url = re.sub(r"^(https?):/(?!/)", r"\1://", url, flags=re.I)
    if "://" not in url:
        host = url.split("/")[0].split("@")[-1]
        name = re.sub(r":\d+$", "", host).strip("[]").lower()
        local = (name in ("localhost", "127.0.0.1", "0.0.0.0", "::1")
                 or "." not in name                       # bare container/service name
                 or re.fullmatch(r"[\d.]+", name) is not None   # bare IP address
                 or bool(_PRIVATE_IP.match(name)))
        url = ("http://" if local else "https://") + url
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return None, f"'{parts.scheme}' is not a web address — start with https:// or http://"
    if not parts.netloc:
        return None, "That address has no host — try https://cloud.example.com"
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", "")), None


def caldav_url_error(exc, url):
    """Turn a connection failure into something worth acting on."""
    parts = urlsplit(url or "")
    host = parts.hostname or "the server"
    port = parts.port or (443 if parts.scheme == "https" else 80)
    reason = getattr(exc, "reason", exc)
    local = host in ("localhost", "127.0.0.1", "::1")
    if isinstance(reason, ssl.SSLError) or "CERTIFICATE" in str(reason).upper():
        if "WRONG_VERSION_NUMBER" in str(reason).upper():
            return f"{host}:{port} speaks plain http, not https — drop the 's' from the address."
        return (f"TLS handshake with {host} failed ({reason}). A self-signed certificate is not accepted — "
                f"use the address your reverse proxy serves, or plain http inside the network.")
    if isinstance(reason, ConnectionRefusedError):
        extra = (" Note that localhost inside this container is the app itself, not Nextcloud — "
                 "use the Nextcloud container name or its external address.") if local else ""
        return f"Nothing is listening on {host}:{port}.{extra}"
    if isinstance(reason, socket.gaierror):
        return (f"Cannot resolve '{host}' from inside this container. If that is a Docker service name, "
                f"both containers have to share a network; otherwise use the address you open in a browser.")
    if isinstance(reason, (TimeoutError, socket.timeout)) or "timed out" in str(reason).lower():
        return f"{host}:{port} did not answer in time — it is probably firewalled or unreachable from here."
    return f"Could not reach {host}: {reason}"


def _caldav_base(s):
    url, _ = caldav_normalize_url(s.get("caldav_url"))
    return url or ""

def _caldav_collection_url(s):
    cal = (s.get("caldav_calendar") or "personal").strip().strip("/")
    return f"{_caldav_base(s)}/remote.php/dav/calendars/{quote(s['caldav_user'])}/{quote(cal)}/"

def _caldav_request(s, method, url, body=None, headers=None, timeout=15, _hops=0):
    req = urllib.request.Request(url, data=body.encode("utf-8") if body else None, method=method)
    token = base64.b64encode(f"{s['caldav_user']}:{s['caldav_password']}".encode()).decode()
    req.add_header("Authorization", "Basic " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        # urllib only redirects GET/HEAD/POST; a proxy that sends http->https
        # would otherwise fail every PUT and DELETE.
        if exc.code in (301, 302, 307, 308) and _hops < 3:
            target = exc.headers.get("Location")
            if target:
                return _caldav_request(s, method, urljoin(url, target), body, headers, timeout, _hops + 1)
        raise


def caldav_write_error(exc, s):
    """A CalDAV failure, in words that point at the fix."""
    if isinstance(exc, urllib.error.HTTPError):
        cal  = (s.get("caldav_calendar") or "personal").strip()
        user = s.get("caldav_user") or "this user"
        hint = {
            401: "the app password was rejected",
            403: f"'{user}' is not allowed to write to calendar '{cal}'",
            404: f"calendar '{cal}' does not exist for '{user}' — check the name in the Calendar field",
            405: "the server refused this method — a reverse proxy in front of Nextcloud is probably blocking PUT",
            409: f"calendar '{cal}' is missing, so there is nowhere to store the event",
            415: "Nextcloud did not accept the event format",
            423: "the calendar is locked",
            507: "the Nextcloud account is out of space",
        }.get(exc.code)
        msg = f"HTTP {exc.code} {exc.reason}"
        if hint:
            return f"{msg} — {hint}"
        try:
            body = re.sub(r"<[^>]+>", " ", exc.read().decode("utf-8", "replace"))
            body = re.sub(r"\s+", " ", body).strip()[:160]
        except Exception:
            body = ""
        return f"{msg}{f' ({body})' if body else ''}"
    return caldav_url_error(exc, _caldav_base(s))

def _ics_escape(text):
    return (str(text or "")
            .replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n"))

def _ics_fold(line):
    """iCalendar lines must not exceed 75 octets; continuations start with a space."""
    out, cur = [], ""
    for ch in line:
        if len(cur.encode("utf-8")) + len(ch.encode("utf-8")) > 73:
            out.append(cur)
            cur = " " + ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n".join(out)

def _ics_utc(ts):
    """'2026-07-25T03:44:32+00:00' or '...Z' -> datetime in UTC (None if unparsable)."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _fmt_minutes(total):
    total = int(total or 0)
    if total <= 0:
        return ""
    h, m = divmod(total, 60)
    return f"{h}h {m}m" if h and m else f"{h}h" if h else f"{m}m"


def _identity_lines(rec):
    """The who/where fields that a planned job and a finished work order share."""
    parts = []
    if rec.get("project_name"):   parts.append(f"Project: {rec['project_name']}")
    if rec.get("org_name"):       parts.append(f"Company: {rec['org_name']}")
    if rec.get("client_name"):    parts.append(f"Customer: {rec['client_name']}")
    if rec.get("site_id"):        parts.append(f"Site ID: {rec['site_id']}")
    if rec.get("assignment_id"):  parts.append(f"Assignment ID: {rec['assignment_id']}")
    if rec.get("ticket_num"):     parts.append(f"Ticket #: {rec['ticket_num']}")
    if rec.get("inc_num"):        parts.append(f"INC #: {rec['inc_num']}")
    if rec.get("mod_name"):       parts.append(f"MOD: {rec['mod_name']}")
    return parts


def _dispatch_lines(rec):
    try:
        contacts = json.loads(rec.get("dispatch_contacts") or "[]")
    except Exception:
        return []
    if not contacts:
        return []
    parts = ["", "Dispatch:"]
    for c in contacts:
        line = f"  {c.get('name') or 'Contact'}: {c.get('value') or ''}"
        if c.get("note"):
            line += f" ({c['note']})"
        parts.append(line)
    return parts


def _job_description(job):
    parts = []
    if job.get("est_minutes"):
        parts.append(f"Estimated: {_fmt_minutes(job['est_minutes'])}")
    parts += _identity_lines(job) + _dispatch_lines(job)
    if job.get("scope_of_work"):
        parts += ["", "Scope of Work:", job["scope_of_work"]]
    return "\n".join(parts)


def _entry_description(entry):
    parts = []
    if entry.get("status"):
        parts.append(f"Status: {str(entry['status']).upper()}")
    ci, co = _ics_utc(entry.get("clock_in")), _ics_utc(entry.get("clock_out"))
    if ci and co and co > ci:
        total = int((co - ci).total_seconds())
        line = f"On site: {_fmt_minutes(total // 60)}"
        est = int(entry.get("est_minutes") or 0)
        if est:
            diff = total // 60 - est
            sign = "+" if diff > 0 else "-"
            line += (f" (estimated {_fmt_minutes(est)}"
                     + (f", {sign}{_fmt_minutes(abs(diff))}" if diff else ", on the nose") + ")")
        parts.append(line)
    brk = int(entry.get("total_break_seconds") or 0)
    if brk:
        parts.append(f"Breaks: {brk // 60}m")
    if entry.get("revisit_required"):
        parts.append("REVISIT REQUIRED")
    parts += _identity_lines(entry)
    if entry.get("release_code"):
        parts.append(f"Release code: {entry['release_code']}")
    parts += _dispatch_lines(entry)
    if entry.get("work_summary"):
        parts += ["", "Work Summary:", entry["work_summary"]]
    return "\n".join(parts)

def _wrap_vevent(uid, dt_lines, summary, sequence, location=None, description=None, category=None):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QuickTec//TimeClock//EN",
        "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
        f"UID:{uid}", f"DTSTAMP:{stamp}", *dt_lines,
        _ics_fold(f"SUMMARY:{_ics_escape(summary)}"),
        f"SEQUENCE:{int(sequence or 0)}",
        "STATUS:CONFIRMED", "TRANSP:OPAQUE",
    ]
    if category:
        lines.append(f"CATEGORIES:{_ics_escape(category)}")
    if location:
        lines.append(_ics_fold(f"LOCATION:{_ics_escape(location)}"))
    if description:
        lines.append(_ics_fold(f"DESCRIPTION:{_ics_escape(description)}"))
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines) + "\r\n"


def build_entry_vevent(entry, sequence=0):
    """VEVENT for a finished work order. Clock times are absolute, so UTC."""
    start = _ics_utc(entry.get("clock_in"))
    end   = _ics_utc(entry.get("clock_out"))
    if not start or not end:
        return None, None          # still clocked in — nothing to record yet
    if end <= start:
        end = start + timedelta(minutes=15)   # zero-length events hide in some clients
    uid = entry.get("calendar_uid") or f"qt-entry-{entry['id']}-{uuid.uuid4().hex[:8]}"
    title = entry.get("wo_title") or entry.get("assignment_id") or "Work order"
    status = (entry.get("status") or "").strip().lower()
    if status in ("fail", "cancel"):
        title = f"[{status.upper()}] {title}"
    ics = _wrap_vevent(
        uid,
        [f"DTSTART:{start.strftime('%Y%m%dT%H%M%SZ')}",
         f"DTEND:{end.strftime('%Y%m%dT%H%M%SZ')}"],
        title, sequence,
        location=entry.get("address"),
        description=_entry_description(entry),
        category="Work Order")
    return uid, ics


def build_vevent(job, duration_min=60, sequence=0):
    """VEVENT for a planned job. Times are floating (local wall clock)."""
    uid = job.get("calendar_uid") or f"qt-planned-{job['id']}-{uuid.uuid4().hex[:8]}"
    date = (job.get("planned_date") or "").strip()
    time_ = (job.get("planned_time") or "").strip()

    if date and time_:
        try:
            start = datetime.strptime(f"{date} {time_}", "%Y-%m-%d %H:%M")
        except ValueError:
            start = datetime.strptime(date, "%Y-%m-%d")
        # The job's own estimate wins over the global default length.
        minutes = int(job.get("est_minutes") or 0) or int(duration_min or 60)
        end = start + timedelta(minutes=minutes)
        dt_lines = [f"DTSTART:{start.strftime('%Y%m%dT%H%M%S')}",
                    f"DTEND:{end.strftime('%Y%m%dT%H%M%S')}"]
    elif date:
        day = datetime.strptime(date, "%Y-%m-%d")
        dt_lines = [f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
                    f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}"]
    else:
        return None, None   # nothing to put on a calendar without a date

    title = job.get("wo_title") or job.get("assignment_id") or "Planned job"
    ics = _wrap_vevent(uid, dt_lines, title, sequence,
                       location=job.get("address"),
                       description=_job_description(job),
                       category="Planned Job")
    return uid, ics

def caldav_push(job, settings=None):
    """Create/update the event for a planned job. Returns (uid, error)."""
    s = settings or caldav_settings()
    if not caldav_ready(s):
        return None, None
    uid, ics = build_vevent(job, s.get("caldav_duration_min", "60"), job.get("calendar_seq", 0))
    if not ics:
        return None, None
    url = _caldav_collection_url(s) + quote(uid) + ".ics"
    try:
        _caldav_request(s, "PUT", url, ics, {"Content-Type": "text/calendar; charset=utf-8"})
        return uid, None
    except Exception as exc:
        err = caldav_write_error(exc, s)
        print(f"CalDAV push failed for job {job.get('id')}: {err}", file=sys.stderr)
        return uid, err

def caldav_delete(uid, settings=None):
    s = settings or caldav_settings()
    if not caldav_ready(s) or not uid:
        return
    try:
        _caldav_request(s, "DELETE", _caldav_collection_url(s) + quote(uid) + ".ics")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            print(f"CalDAV delete failed for {uid}: {exc}", file=sys.stderr)
    except Exception as exc:
        print(f"CalDAV delete failed for {uid}: {exc}", file=sys.stderr)

def caldav_sync_async(job_id):
    """Push a planned job in the background and store the resulting UID."""
    def work():
        try:
            with get_db() as db:
                s = caldav_settings(db)
                if not caldav_ready(s):
                    return
                job = row_to_dict(db.execute(PLANNED_SELECT + " WHERE pj.id=?", (job_id,)).fetchone())
            if not job:
                return
            uid, err = caldav_push(job, s)
            if uid and not err:
                with get_db() as db:
                    db.execute(
                        "UPDATE planned_jobs SET calendar_uid=?, calendar_seq=COALESCE(calendar_seq,0)+1 WHERE id=?",
                        (uid, job_id))
        except Exception as exc:
            print(f"CalDAV sync thread error: {exc}", file=sys.stderr)
    threading.Thread(target=work, daemon=True).start()

def caldav_delete_async(uid):
    if not uid:
        return
    threading.Thread(target=lambda: caldav_delete(uid), daemon=True).start()

def caldav_entries_on(s):
    return caldav_ready(s) and s.get("caldav_sync_entries", "1") == "1"

def caldav_push_entry(entry, settings=None):
    """Create/update the event for a finished work order. Returns (uid, error)."""
    s = settings or caldav_settings()
    if not caldav_entries_on(s):
        return None, None
    uid, ics = build_entry_vevent(entry, entry.get("calendar_seq", 0))
    if not ics:
        return None, None
    try:
        _caldav_request(s, "PUT", _caldav_collection_url(s) + quote(uid) + ".ics", ics,
                        {"Content-Type": "text/calendar; charset=utf-8"})
        return uid, None
    except Exception as exc:
        err = caldav_write_error(exc, s)
        print(f"CalDAV push failed for entry {entry.get('id')}: {err}", file=sys.stderr)
        return uid, err

def caldav_entry_sync_async(entry_id):
    """Push a finished work order in the background and store the resulting UID."""
    def work():
        try:
            with get_db() as db:
                s = caldav_settings(db)
                if not caldav_entries_on(s):
                    return
                entry = row_to_dict(db.execute(ENTRY_SELECT + " WHERE e.id=?", (entry_id,)).fetchone())
            if not entry:
                return
            uid, err = caldav_push_entry(entry, s)
            if uid and not err:
                with get_db() as db:
                    db.execute(
                        "UPDATE time_entries SET calendar_uid=?, calendar_seq=COALESCE(calendar_seq,0)+1 WHERE id=?",
                        (uid, entry_id))
        except Exception as exc:
            print(f"CalDAV entry sync thread error: {exc}", file=sys.stderr)
    threading.Thread(target=work, daemon=True).start()


def caldav_probe_calendar(s):
    """Write a throwaway event and remove it. Returns an error message, or None.

    Listing calendars proves the credentials work; it does not prove the target
    calendar exists or accepts writes, which is what actually matters here.
    """
    uid = f"qt-selftest-{uuid.uuid4().hex[:12]}"
    ics = _wrap_vevent(uid, ["DTSTART;VALUE=DATE:19700101", "DTEND;VALUE=DATE:19700102"],
                       "QuickTec connection test", 0)
    url = _caldav_collection_url(s) + uid + ".ics"
    try:
        _caldav_request(s, "PUT", url, ics, {"Content-Type": "text/calendar; charset=utf-8"})
    except Exception as exc:
        return caldav_write_error(exc, s)
    try:
        _caldav_request(s, "DELETE", url)
    except Exception as exc:
        print(f"CalDAV self-test left {uid} behind: {exc}", file=sys.stderr)
    return None


def caldav_backfill(force=False, settings=None):
    """Push planned jobs and finished work orders to the calendar.

    force=False only touches records that have never reached the calendar, so it
    is cheap enough to run whenever settings change or the server starts — that
    is also what heals anything missed while Nextcloud was unreachable.
    """
    s = settings or caldav_settings()
    if not caldav_ready(s):
        return {"synced": 0, "failed": [], "errors": [], "total": 0}

    with get_db() as db:
        sql = PLANNED_SELECT + " WHERE pj.planned_date IS NOT NULL AND pj.planned_date != ''"
        if not force:
            sql += " AND (pj.calendar_uid IS NULL OR pj.calendar_uid = '')"
        jobs = rows_to_list(db.execute(sql).fetchall())

        entries = []
        if caldav_entries_on(s):
            sql = ENTRY_SELECT + " WHERE e.clock_out IS NOT NULL"
            if not force:
                sql += " AND (e.calendar_uid IS NULL OR e.calendar_uid = '')"
            entries = rows_to_list(db.execute(sql + " ORDER BY e.clock_in").fetchall())

    total = len(jobs) + len(entries)
    failed, errors = [], {}

    def note(err, title):
        failed.append(title)
        errors.setdefault(err, []).append(title)

    def report(synced):
        return {"synced": synced, "failed": failed, "total": total,
                "errors": [{"message": m, "count": len(t), "examples": t[:3]}
                           for m, t in errors.items()]}

    if total and (err := caldav_probe_calendar(s)):
        # One clear reason beats the same failure repeated for every job.
        for rec in jobs:
            note(err, rec.get("wo_title") or f"planned job {rec['id']}")
        for rec in entries:
            note(err, rec.get("wo_title") or f"work order {rec['id']}")
        return report(0)

    synced = 0
    for job in jobs:
        uid, err = caldav_push(job, s)
        if uid and not err:
            with get_db() as db:
                db.execute("UPDATE planned_jobs SET calendar_uid=?, calendar_seq=COALESCE(calendar_seq,0)+1 WHERE id=?",
                           (uid, job["id"]))
            synced += 1
        elif err:
            note(err, job.get("wo_title") or f"planned job {job['id']}")

    for entry in entries:
        uid, err = caldav_push_entry(entry, s)
        if uid and not err:
            with get_db() as db:
                db.execute("UPDATE time_entries SET calendar_uid=?, calendar_seq=COALESCE(calendar_seq,0)+1 WHERE id=?",
                           (uid, entry["id"]))
            synced += 1
        elif err:
            note(err, entry.get("wo_title") or f"work order {entry['id']}")

    return report(synced)


def caldav_backfill_async():
    """Catch up on anything the calendar is missing, quietly, in the background."""
    def work():
        try:
            s = caldav_settings()
            if not caldav_ready(s):
                return
            r = caldav_backfill(force=False, settings=s)
            if r["total"]:
                print(f"CalDAV catch-up: {r['synced']}/{r['total']} pushed"
                      + (f", {len(r['failed'])} failed" if r["failed"] else ""), file=sys.stderr)
        except Exception as exc:
            print(f"CalDAV catch-up error: {exc}", file=sys.stderr)
    threading.Thread(target=work, daemon=True).start()


def ftp_sync_photo(local_path, remote_filename, settings):
    if settings.get('ftp_enabled') != '1' or not settings.get('ftp_host', '').strip():
        return False
    try:
        ftp = ftplib.FTP()
        ftp.connect(settings['ftp_host'], int(settings.get('ftp_port', 21)), timeout=15)
        ftp.login(settings.get('ftp_user', ''), settings.get('ftp_password', ''))
        remote_dir = settings.get('ftp_path', '/timeclock/photos').rstrip('/')
        # Create directory tree
        parts = remote_dir.lstrip('/').split('/')
        ftp.cwd('/')
        for part in parts:
            try:
                ftp.cwd(part)
            except ftplib.error_perm:
                ftp.mkd(part)
                ftp.cwd(part)
        with open(local_path, 'rb') as f:
            ftp.storbinary(f'STOR {remote_filename}', f)
        ftp.quit()
        return True
    except Exception as exc:
        print(f"FTP sync failed: {exc}", file=sys.stderr)
        return False


# ── Helpers ────────────────────────────────────────────────────────────────────

def dt_diff_seconds(start_iso, end_iso):
    def parse(s):
        s = s.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    try:
        return max(0, int((parse(end_iso) - parse(start_iso)).total_seconds()))
    except Exception:
        return 0


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── Router ─────────────────────────────────────────────────────────────────────

def route(path, method, routes):
    for pattern, methods, handler in routes:
        if method not in methods:
            continue
        m = re.fullmatch(pattern, path)
        if m:
            return handler, m.groups()
    return None, None


# ── API handlers ───────────────────────────────────────────────────────────────

def h_get_orgs(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute("SELECT * FROM organizations ORDER BY name").fetchall())
    return 200, rows


def h_post_org(req, _groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    address = (data.get("address") or "").strip() or None
    with get_db() as db:
        cur = db.execute("INSERT INTO organizations (name, address) VALUES (?, ?)", (name, address))
        row = row_to_dict(db.execute("SELECT * FROM organizations WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, row


def h_put_org(req, groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    address = (data.get("address") or "").strip() or None
    oid = groups[0]
    with get_db() as db:
        cur = db.execute("UPDATE organizations SET name=?, address=? WHERE id=?", (name, address, oid))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
        row = row_to_dict(db.execute("SELECT * FROM organizations WHERE id=?", (oid,)).fetchone())
    return 200, row


def h_delete_org(req, groups):
    with get_db() as db:
        cur = db.execute("DELETE FROM organizations WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}


# ── Clients ────────────────────────────────────────────────────────────────────

def h_get_clients(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute("SELECT * FROM clients ORDER BY name").fetchall())
    return 200, rows


def h_post_client(req, _groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    with get_db() as db:
        cur = db.execute("INSERT INTO clients (name) VALUES (?)", (name,))
        row = row_to_dict(db.execute("SELECT * FROM clients WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, row


def h_put_client(req, groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    cid = groups[0]
    with get_db() as db:
        cur = db.execute("UPDATE clients SET name=? WHERE id=?", (name, cid))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
        row = row_to_dict(db.execute("SELECT * FROM clients WHERE id=?", (cid,)).fetchone())
    return 200, row


def h_delete_client(req, groups):
    with get_db() as db:
        cur = db.execute("DELETE FROM clients WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}


# ── Pay Rates ──────────────────────────────────────────────────────────────────

def h_get_rates(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute("SELECT * FROM pay_rates ORDER BY name").fetchall())
    return 200, rows


def h_post_rate(req, _groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    try:
        rate = float(data.get("rate", 0))
        assert rate > 0
    except Exception:
        return 400, {"error": "Valid rate is required"}
    currency = (data.get("currency") or "USD").strip() or "USD"
    with get_db() as db:
        cur = db.execute("INSERT INTO pay_rates (name, rate, currency) VALUES (?, ?, ?)", (name, rate, currency))
        row = row_to_dict(db.execute("SELECT * FROM pay_rates WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, row


def h_put_rate(req, groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name is required"}
    try:
        rate = float(data.get("rate", 0))
        assert rate > 0
    except Exception:
        return 400, {"error": "Valid rate is required"}
    currency = (data.get("currency") or "USD").strip() or "USD"
    rid = groups[0]
    with get_db() as db:
        cur = db.execute("UPDATE pay_rates SET name=?, rate=?, currency=? WHERE id=?", (name, rate, currency, rid))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
        row = row_to_dict(db.execute("SELECT * FROM pay_rates WHERE id=?", (rid,)).fetchone())
    return 200, row


def h_delete_rate(req, groups):
    with get_db() as db:
        cur = db.execute("DELETE FROM pay_rates WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}


# ── Time Entries ───────────────────────────────────────────────────────────────

ENTRY_SELECT = """
    SELECT e.*, o.name as org_name, c.name as client_name,
           p.name as rate_name, p.rate as hourly_rate, p.currency,
           pr.name as project_name
    FROM time_entries e
    LEFT JOIN organizations o ON e.organization_id = o.id
    LEFT JOIN clients c ON e.client_id = c.id
    LEFT JOIN pay_rates p ON e.pay_rate_id = p.id
    LEFT JOIN projects pr ON e.project_id = pr.id
"""


def attach_breaks(db, entry):
    if entry is None:
        return None
    breaks = rows_to_list(db.execute("SELECT * FROM breaks WHERE entry_id=? ORDER BY break_start", (entry["id"],)).fetchall())
    active_break = db.execute("SELECT * FROM breaks WHERE entry_id=? AND break_end IS NULL", (entry["id"],)).fetchone()
    entry["breaks"] = breaks
    entry["active_break"] = row_to_dict(active_break)
    return entry


def h_get_current(req, _groups):
    with get_db() as db:
        row = db.execute(ENTRY_SELECT + " WHERE e.clock_out IS NULL ORDER BY e.clock_in DESC LIMIT 1").fetchone()
        entry = attach_breaks(db, row_to_dict(row))
    return 200, entry


def h_get_entries(req, _groups):
    params = req.get("query", {})
    frm = params.get("from", [None])[0]
    to  = params.get("to", [None])[0]
    sql = ENTRY_SELECT + " WHERE 1=1"
    args = []
    if frm:
        sql += " AND e.clock_in >= ?"; args.append(frm)
    if to:
        sql += " AND e.clock_in <= ?"; args.append(to)
    sql += " ORDER BY e.clock_in DESC"
    with get_db() as db:
        rows = rows_to_list(db.execute(sql, args).fetchall())
        result = [attach_breaks(db, r) for r in rows]
    return 200, result


def h_post_entry(req, _groups):
    data = req.get("body", {})
    clock_in = data.get("clock_in")
    if not clock_in:
        return 400, {"error": "clock_in is required"}
    materials = data.get("materials")
    materials_str = json.dumps(materials) if isinstance(materials, (list, dict)) else None
    with get_db() as db:
        existing = db.execute("SELECT id FROM time_entries WHERE clock_out IS NULL").fetchone()
        if existing:
            return 409, {"error": "Already clocked in", "entry_id": existing["id"]}
        cur = db.execute(
            """INSERT INTO time_entries
            (organization_id, client_id, pay_rate_id, rate_type, flat_amount,
             clock_in, address, latitude, longitude, site_id, comment,
             assignment_id, ticket_num, inc_num, mod_name, noc_name, pm_pc_name,
             parking_tolls, is_replacement, old_serial, new_serial, return_track, no_return_track,
             work_summary, additional_info, wo_title, travel_reimb,
             status, release_code, no_release_code, materials, project_id, revisit_of,
             scope_of_work, dispatch_contacts, est_minutes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (data.get("organization_id"), data.get("client_id"), data.get("pay_rate_id"),
             data.get("rate_type", "hourly"), data.get("flat_amount"),
             clock_in, data.get("address"), data.get("latitude"), data.get("longitude"),
             data.get("site_id"), data.get("comment"),
             data.get("assignment_id"), data.get("ticket_num"), data.get("inc_num"),
             data.get("mod_name"), data.get("noc_name"), data.get("pm_pc_name"),
             data.get("parking_tolls"), 1 if data.get("is_replacement") else 0,
             data.get("old_serial"), data.get("new_serial"), data.get("return_track"),
             1 if data.get("no_return_track") else 0,
             data.get("work_summary"), data.get("additional_info"),
             data.get("wo_title"), data.get("travel_reimb"),
             data.get("status", "pending"), data.get("release_code"),
             1 if data.get("no_release_code") else 0, materials_str,
             data.get("project_id"), data.get("revisit_of"),
             data.get("scope_of_work"), data.get("dispatch_contacts"),
             data.get("est_minutes"))
        )
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (cur.lastrowid,)).fetchone()
        entry = attach_breaks(db, row_to_dict(row))
    return 201, entry


def h_put_entry(req, groups):
    data = req.get("body", {})
    eid = groups[0]
    old_folder = new_folder = None
    with get_db() as db:
        ex = row_to_dict(db.execute("SELECT * FROM time_entries WHERE id=?", (eid,)).fetchone())
        if not ex:
            return 404, {"error": "Not found"}
        old_folder = _photo_folder(ex, eid)
        materials = data.get("materials")
        if materials is not None:
            materials_str = json.dumps(materials) if isinstance(materials, (list, dict)) else materials
        else:
            materials_str = ex.get("materials")
        db.execute("""
            UPDATE time_entries SET
                organization_id=?, client_id=?, pay_rate_id=?, rate_type=?, flat_amount=?,
                clock_in=?, clock_out=?, address=?, latitude=?, longitude=?, site_id=?, comment=?,
                assignment_id=?, ticket_num=?, inc_num=?, mod_name=?, noc_name=?, pm_pc_name=?,
                parking_tolls=?, is_replacement=?, old_serial=?, new_serial=?,
                return_track=?, no_return_track=?, work_summary=?, additional_info=?,
                wo_title=?, travel_reimb=?, revisit_required=?, received_pay=?,
                status=?, release_code=?, no_release_code=?, materials=?,
                pay_adjustment=?, pay_adjustment_note=?, received_date=?, project_id=?,
                revisit_of=?, custom_photo_fields=?,
                scope_of_work=?, dispatch_contacts=?, pre_clockout=?, est_minutes=?
            WHERE id=?
        """, (
            data.get("organization_id", ex["organization_id"]),
            data.get("client_id", ex.get("client_id")),
            data.get("pay_rate_id", ex["pay_rate_id"]),
            data.get("rate_type", ex.get("rate_type", "hourly")),
            data.get("flat_amount", ex.get("flat_amount")),
            data.get("clock_in", ex["clock_in"]),
            data.get("clock_out", ex["clock_out"]),
            data.get("address", ex["address"]),
            data.get("latitude", ex["latitude"]),
            data.get("longitude", ex["longitude"]),
            data.get("site_id", ex.get("site_id")),
            data.get("comment", ex.get("comment")),
            data.get("assignment_id", ex.get("assignment_id")),
            data.get("ticket_num", ex.get("ticket_num")),
            data.get("inc_num", ex.get("inc_num")),
            data.get("mod_name", ex.get("mod_name")),
            data.get("noc_name", ex.get("noc_name")),
            data.get("pm_pc_name", ex.get("pm_pc_name")),
            data.get("parking_tolls", ex.get("parking_tolls")),
            1 if data.get("is_replacement", ex.get("is_replacement", 0)) else 0,
            data.get("old_serial", ex.get("old_serial")),
            data.get("new_serial", ex.get("new_serial")),
            data.get("return_track", ex.get("return_track")),
            1 if data.get("no_return_track", ex.get("no_return_track", 0)) else 0,
            data.get("work_summary", ex.get("work_summary")),
            data.get("additional_info", ex.get("additional_info")),
            data.get("wo_title", ex.get("wo_title")),
            data.get("travel_reimb", ex.get("travel_reimb")),
            1 if data.get("revisit_required", ex.get("revisit_required", 0)) else 0,
            data.get("received_pay", ex.get("received_pay")),
            data.get("status", ex.get("status", "pending")),
            data.get("release_code", ex.get("release_code")),
            1 if data.get("no_release_code", ex.get("no_release_code", 0)) else 0,
            materials_str,
            data.get("pay_adjustment", ex.get("pay_adjustment")),
            data.get("pay_adjustment_note", ex.get("pay_adjustment_note")),
            data.get("received_date", ex.get("received_date")),
            data.get("project_id", ex.get("project_id")),
            data.get("revisit_of", ex.get("revisit_of")),
            data.get("custom_photo_fields", ex.get("custom_photo_fields")),
            data.get("scope_of_work", ex.get("scope_of_work")),
            data.get("dispatch_contacts", ex.get("dispatch_contacts")),
            data.get("pre_clockout", ex.get("pre_clockout")),
            data.get("est_minutes", ex.get("est_minutes")),
            eid
        ))
        new_folder = _photo_folder({
            "clock_in":      data.get("clock_in", ex["clock_in"]),
            "assignment_id": data.get("assignment_id", ex.get("assignment_id")),
        }, eid)
        if old_folder != new_folder:
            db.execute(
                "UPDATE entry_photos SET folder=? WHERE entry_id=? AND folder=?",
                (new_folder, eid, old_folder)
            )
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (eid,)).fetchone()
        entry = attach_breaks(db, row_to_dict(row))
    if old_folder and new_folder and old_folder != new_folder:
        old_dir = UPLOADS_DIR / old_folder
        new_dir = UPLOADS_DIR / new_folder
        if old_dir.exists():
            try:
                new_dir.parent.mkdir(parents=True, exist_ok=True)
                old_dir.rename(new_dir)
            except Exception:
                pass
    caldav_entry_sync_async(eid)
    return 200, entry


def h_clockout(req, groups):
    data = req.get("body", {})
    eid = groups[0]
    clock_out = data.get("clock_out") or now_iso()
    with get_db() as db:
        entry = row_to_dict(db.execute("SELECT * FROM time_entries WHERE id=?", (eid,)).fetchone())
        if not entry:
            return 404, {"error": "Not found"}
        db.execute("UPDATE breaks SET break_end=? WHERE entry_id=? AND break_end IS NULL", (clock_out, eid))
        breaks = rows_to_list(db.execute("SELECT * FROM breaks WHERE entry_id=? AND break_end IS NOT NULL", (eid,)).fetchall())
        total_break = sum(dt_diff_seconds(b["break_start"], b["break_end"]) for b in breaks)
        materials = data.get("materials")
        if materials is not None:
            materials_str = json.dumps(materials) if isinstance(materials, (list, dict)) else materials
        else:
            materials_str = entry["materials"]
        db.execute("""UPDATE time_entries SET
            clock_out=?, comment=?, total_break_seconds=?,
            status=?, release_code=?, no_release_code=?,
            work_summary=?, assignment_id=?, ticket_num=?, inc_num=?,
            mod_name=?, noc_name=?, pm_pc_name=?, parking_tolls=?,
            is_replacement=?, old_serial=?, new_serial=?, return_track=?, no_return_track=?,
            additional_info=?, materials=?, wo_title=?, travel_reimb=?,
            revisit_required=?
            WHERE id=?""",
            (clock_out, data.get("comment", entry["comment"]), total_break,
             data.get("status", entry["status"] or "pending"),
             data.get("release_code", entry["release_code"]),
             1 if data.get("no_release_code", entry["no_release_code"]) else 0,
             data.get("work_summary", entry["work_summary"]),
             data.get("assignment_id", entry["assignment_id"]),
             data.get("ticket_num", entry["ticket_num"]),
             data.get("inc_num", entry["inc_num"]),
             data.get("mod_name", entry["mod_name"]),
             data.get("noc_name", entry["noc_name"]),
             data.get("pm_pc_name", entry["pm_pc_name"]),
             data.get("parking_tolls", entry["parking_tolls"]),
             1 if data.get("is_replacement", entry["is_replacement"]) else 0,
             data.get("old_serial", entry["old_serial"]),
             data.get("new_serial", entry["new_serial"]),
             data.get("return_track", entry["return_track"]),
             1 if data.get("no_return_track", entry["no_return_track"]) else 0,
             data.get("additional_info", entry["additional_info"]),
             materials_str,
             data.get("wo_title", entry.get("wo_title")),
             data.get("travel_reimb", entry.get("travel_reimb")),
             1 if data.get("revisit_required", entry.get("revisit_required", 0)) else 0,
             eid))
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (eid,)).fetchone()
        result = row_to_dict(row)
        result["breaks"] = breaks
        result["active_break"] = None
    caldav_entry_sync_async(eid)
    return 200, result


def h_start_break(req, groups):
    data = req.get("body", {})
    eid = groups[0]
    with get_db() as db:
        entry = db.execute("SELECT * FROM time_entries WHERE id=? AND clock_out IS NULL", (eid,)).fetchone()
        if not entry:
            return 404, {"error": "Entry not found or already clocked out"}
        existing = db.execute("SELECT * FROM breaks WHERE entry_id=? AND break_end IS NULL", (eid,)).fetchone()
        if existing:
            return 409, {"error": "Already on break"}
        break_start = data.get("break_start") or now_iso()
        cur = db.execute("INSERT INTO breaks (entry_id, break_start) VALUES (?, ?)", (eid, break_start))
        b = row_to_dict(db.execute("SELECT * FROM breaks WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, b


def h_end_break(req, groups):
    data = req.get("body", {})
    eid = groups[0]
    with get_db() as db:
        active = db.execute("SELECT * FROM breaks WHERE entry_id=? AND break_end IS NULL", (eid,)).fetchone()
        if not active:
            return 404, {"error": "No active break"}
        break_end = data.get("break_end") or now_iso()
        db.execute("UPDATE breaks SET break_end=? WHERE id=?", (break_end, active["id"]))
        breaks = rows_to_list(db.execute("SELECT * FROM breaks WHERE entry_id=? AND break_end IS NOT NULL", (eid,)).fetchall())
        total_break = sum(dt_diff_seconds(b["break_start"], b["break_end"]) for b in breaks)
        db.execute("UPDATE time_entries SET total_break_seconds=? WHERE id=?", (total_break, eid))
        b = row_to_dict(db.execute("SELECT * FROM breaks WHERE id=?", (active["id"],)).fetchone())
    return 200, b


def h_start_trip_pause(req, groups):
    data = req.get("body", {})
    tid = groups[0]
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=? AND status='active'", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Trip not found or not active"}
        existing = db.execute("SELECT * FROM trip_pauses WHERE trip_id=? AND pause_end IS NULL", (tid,)).fetchone()
        if existing:
            return 409, {"error": "Trip already paused"}
        pause_start = data.get("pause_start") or now_iso()
        cur = db.execute("INSERT INTO trip_pauses (trip_id, pause_start) VALUES (?, ?)", (tid, pause_start))
        # Append pause note
        now_str = datetime.now().strftime('%H:%M')
        old_notes = (trip.get("notes") or "").strip()
        pause_note = f"{now_str} - Trip paused"
        new_notes = (old_notes + "\n" + pause_note).strip() if old_notes else pause_note
        db.execute("UPDATE trips SET notes=?, updated_at=datetime('now') WHERE id=?", (new_notes, tid))
        b = row_to_dict(db.execute("SELECT * FROM trip_pauses WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, b


def h_end_trip_pause(req, groups):
    data = req.get("body", {})
    tid = groups[0]
    with get_db() as db:
        active = db.execute("SELECT * FROM trip_pauses WHERE trip_id=? AND pause_end IS NULL", (tid,)).fetchone()
        if not active:
            return 404, {"error": "No active pause"}
        pause_end = data.get("pause_end") or now_iso()
        db.execute("UPDATE trip_pauses SET pause_end=? WHERE id=?", (pause_end, active["id"]))
        pauses = rows_to_list(db.execute(
            "SELECT * FROM trip_pauses WHERE trip_id=? AND pause_end IS NOT NULL", (tid,)
        ).fetchall())
        total_pause = sum(dt_diff_seconds(p["pause_start"], p["pause_end"]) for p in pauses)
        # Append resume note
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        now_str = datetime.now().strftime('%H:%M')
        old_notes = (trip.get("notes") or "").strip()
        resume_note = f"{now_str} - Trip resumed"
        new_notes = (old_notes + "\n" + resume_note).strip() if old_notes else resume_note
        db.execute(
            "UPDATE trips SET total_pause_seconds=?, notes=?, updated_at=datetime('now') WHERE id=?",
            (total_pause, new_notes, tid)
        )
        b = row_to_dict(db.execute("SELECT * FROM trip_pauses WHERE id=?", (active["id"],)).fetchone())
    return 200, b


def h_delete_entry(req, groups):
    eid = groups[0]
    photos = []
    with get_db() as db:
        photos = rows_to_list(db.execute(
            "SELECT * FROM entry_photos WHERE entry_id=?", (eid,)
        ).fetchall())
        existing = row_to_dict(db.execute("SELECT calendar_uid FROM time_entries WHERE id=?", (eid,)).fetchone())
        cur = db.execute("DELETE FROM time_entries WHERE id=?", (eid,))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    for photo in photos:
        fp = UPLOADS_DIR / (photo.get('folder') or str(eid)) / photo['filename']
        try: fp.unlink(missing_ok=True)
        except Exception: pass
    caldav_delete_async((existing or {}).get("calendar_uid"))
    return 200, {"success": True}


# ── Photos ─────────────────────────────────────────────────────────────────────

def _photo_folder(entry_row, eid):
    """Compute folder path: YYYY/MM/DD-AssignmentID"""
    clock_in = (entry_row or {}).get('clock_in') or ''
    assignment_id = re.sub(r'[^\w-]', '', ((entry_row or {}).get('assignment_id') or '').strip())
    try:
        dt = datetime.fromisoformat(clock_in.replace('Z', '+00:00'))
        yyyy, mm, dd = dt.strftime('%Y'), dt.strftime('%m'), dt.strftime('%d')
    except Exception:
        yyyy, mm, dd = 'XXXX', 'XX', 'XX'
    suffix = assignment_id if assignment_id else str(eid)
    return f"{yyyy}/{mm}/{dd}-{suffix}"


CAT_SHORTCUTS = {
    "In Route to WO":        "WO",
    "Returning Home":        "HOME",
    "OffClock Tools/Supplies": "OFFT",
    "OnClock Tools/Supplies":  "ONT",
    "Other":                  "OTH",
}

def _trip_folder(start_time_iso):
    """All trip photos land in Miles/YYYY/MM/DD (based on trip start only)."""
    try:
        dt = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        return f"Miles/{dt.strftime('%Y')}/{dt.strftime('%m')}/{dt.strftime('%d')}"
    except Exception:
        return "Miles/XXXX/XX/XX"

def _trip_id_str(db_id, category, assignment_id):
    """
    Global auto-increment id as the base.
    In Route to WO + assignment : '{db_id}-{assignment_id}'
    In Route to WO + no assignment: '{db_id}-TMPNOID'
    All other categories: '{db_id}'
    """
    if category == "In Route to WO":
        if assignment_id and assignment_id.strip():
            return f"{db_id}-{assignment_id.strip()}"
        return f"{db_id}-TMPNOID"
    return str(db_id)

def _trip_photo_filename(start_time_iso, photo_type, category, trip_id_str, ext='.jpg'):
    """YY-MM-DD-Bef/Aft-CAT-TripID.ext"""
    try:
        dt = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        prefix = dt.strftime('%y-%m-%d')
    except Exception:
        prefix = 'XX-XX-XX'
    bef_aft = 'Aft' if 'after' in photo_type.lower() else 'Bef'
    cat = CAT_SHORTCUTS.get(category, 'OTH')
    return f"{prefix}-{bef_aft}-{cat}-{trip_id_str}{ext}"


def h_get_photos(req, groups):
    eid = groups[0]
    with get_db() as db:
        rows = rows_to_list(db.execute(
            "SELECT * FROM entry_photos WHERE entry_id=? ORDER BY created_at", (eid,)
        ).fetchall())
    for r in rows:
        folder = r.get('folder') or str(eid)
        r['url'] = f"/uploads/{folder}/{r['filename']}"
    return 200, rows


def h_post_photo(req, groups):
    eid = groups[0]
    data = req.get("body", {})
    photo_type = (data.get("photo_type") or "before").strip()
    b64data = data.get("data", "")
    original_name = (data.get("filename") or "photo.jpg").strip()
    mime = (data.get("mime") or "image/jpeg").lower()

    if not b64data:
        return 400, {"error": "No image data"}
    try:
        img_bytes = base64.b64decode(b64data)
    except Exception:
        return 400, {"error": "Invalid base64 data"}

    ext = ".jpg"
    if "png" in mime: ext = ".png"
    elif "webp" in mime: ext = ".webp"
    elif "gif" in mime: ext = ".gif"
    elif "pdf" in mime: ext = ".pdf"

    with get_db() as db:
        entry_row = row_to_dict(db.execute(
            "SELECT clock_in, assignment_id FROM time_entries WHERE id=?", (eid,)
        ).fetchone())
        settings = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings").fetchall()}

    folder = _photo_folder(entry_row, eid)
    name_hint = re.sub(r'[^\w-]', '', (data.get("name_hint") or "").strip().replace(' ', '-'))[:60]
    if name_hint:
        safe_name = f"{name_hint}-{uuid.uuid4().hex[:6]}{ext}"
    else:
        safe_name = f"{photo_type}_{uuid.uuid4().hex[:10]}{ext}"
    entry_dir = UPLOADS_DIR / folder
    entry_dir.mkdir(parents=True, exist_ok=True)
    file_path = entry_dir / safe_name
    file_path.write_bytes(img_bytes)

    ftp_remote = f"{folder.replace('/', '_')}_{safe_name}"
    ftp_synced = 1 if ftp_sync_photo(str(file_path), ftp_remote, settings) else 0

    with get_db() as db:
        cur = db.execute(
            "INSERT INTO entry_photos (entry_id, photo_type, filename, folder, original_name, ftp_synced) VALUES (?, ?, ?, ?, ?, ?)",
            (eid, photo_type, safe_name, folder, original_name, ftp_synced)
        )
        row = row_to_dict(db.execute("SELECT * FROM entry_photos WHERE id=?", (cur.lastrowid,)).fetchone())

    row['url'] = f"/uploads/{folder}/{safe_name}"
    return 201, row


def h_delete_photo(req, groups):
    eid, photo_id = groups
    with get_db() as db:
        photo = row_to_dict(db.execute(
            "SELECT * FROM entry_photos WHERE id=? AND entry_id=?", (photo_id, eid)
        ).fetchone())
        if not photo:
            return 404, {"error": "Not found"}
        db.execute("DELETE FROM entry_photos WHERE id=?", (photo_id,))

    folder = photo.get('folder') or str(eid)
    file_path = UPLOADS_DIR / folder / photo['filename']
    try:
        file_path.unlink(missing_ok=True)
    except Exception:
        pass
    return 200, {"success": True}


def h_get_pay_periods(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute(
            "SELECT * FROM pay_periods ORDER BY week_start DESC"
        ).fetchall())
    return 200, rows


def h_upsert_pay_period(req, _groups):
    data = req.get("body", {})
    week_start = (data.get("week_start") or "").strip()
    week_end   = (data.get("week_end")   or "").strip()
    if not week_start or not week_end:
        return 400, {"error": "week_start and week_end required"}
    status          = data.get("status", "pending")
    received_amount = data.get("received_amount")
    expected_total  = data.get("expected_total")
    notes           = data.get("notes")
    paid_at         = data.get("paid_at")
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM pay_periods WHERE week_start=?", (week_start,)
        ).fetchone()
        if existing:
            db.execute(
                """UPDATE pay_periods
                   SET status=?, received_amount=?, expected_total=?, notes=?,
                       paid_at=?, updated_at=datetime('now')
                   WHERE week_start=?""",
                (status, received_amount, expected_total, notes, paid_at, week_start)
            )
            pid = existing["id"]
        else:
            cur = db.execute(
                """INSERT INTO pay_periods
                   (week_start, week_end, status, received_amount, expected_total, notes, paid_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (week_start, week_end, status, received_amount, expected_total, notes, paid_at)
            )
            pid = cur.lastrowid
        row = row_to_dict(db.execute(
            "SELECT * FROM pay_periods WHERE id=?", (pid,)
        ).fetchone())
    return 200, row


# ── Settings ───────────────────────────────────────────────────────────────────

# Secrets never travel back to the browser; it only learns whether one is stored.
SECRET_SETTINGS = ("caldav_password", "ftp_password")


def public_settings(rows):
    out = {}
    for r in rows:
        if r["key"] in SECRET_SETTINGS:
            out[r["key"] + "_set"] = "1" if (r["value"] or "").strip() else "0"
        else:
            out[r["key"]] = r["value"]
    return out


def h_get_settings(req, _groups):
    with get_db() as db:
        rows = db.execute("SELECT key, value FROM settings").fetchall()
    return 200, public_settings(rows)


def h_put_settings(req, _groups):
    data = dict(req.get("body", {}))
    if "caldav_url" in data:
        url, err = caldav_normalize_url(data["caldav_url"])
        if err:
            return 400, {"error": err}
        data["caldav_url"] = url
    with get_db() as db:
        for k, v in data.items():
            k = str(k)
            if k.endswith("_set"):
                continue                      # read-only flag from GET
            if k in SECRET_SETTINGS and not str(v).strip():
                continue                      # blank means "keep the stored secret"
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))
        rows = db.execute("SELECT key, value FROM settings").fetchall()
    # Turning sync on (or pointing it at another calendar) backfills the history.
    caldav_backfill_async()
    return 200, public_settings(rows)


# ── Reports ────────────────────────────────────────────────────────────────────

def h_export_csv(req, _groups):
    from datetime import timedelta

    from datetime import timezone as _tz
    params = req.get("query", {})
    frm = params.get("from", [None])[0]
    to  = params.get("to",  [None])[0]
    tz_offset = int(params.get("tz", [0])[0] or 0)  # minutes west of UTC (JS getTimezoneOffset())
    local_tz = _tz(timedelta(minutes=-tz_offset))

    sql = ENTRY_SELECT + " WHERE 1=1"
    args = []
    if frm: sql += " AND e.clock_in >= ?"; args.append(frm)
    if to:  sql += " AND e.clock_in <= ?"; args.append(to)
    sql += " ORDER BY e.clock_in ASC"

    with get_db() as db:
        rows       = rows_to_list(db.execute(sql, args).fetchall())
        pp_rows    = rows_to_list(db.execute("SELECT * FROM pay_periods ORDER BY week_start").fetchall())
        ws_setting = db.execute("SELECT value FROM settings WHERE key='week_start'").fetchone()
        pb_setting = db.execute("SELECT value FROM settings WHERE key='paid_breaks'").fetchone()

    week_start_wd = ((int(ws_setting["value"]) if ws_setting else 1) - 1) % 7  # Mon=0..Sun=6
    paid_breaks   = (pb_setting["value"] if pb_setting else "0") == "1"
    pay_map       = {pp["week_start"]: pp for pp in pp_rows}

    multi_week = False
    if frm and to:
        try:
            multi_week = (datetime.fromisoformat(to[:10]) - datetime.fromisoformat(frm[:10])).days > 8
        except Exception:
            pass

    def cell(v):
        return '"' + str(v or "").replace('"', '""') + '"'

    def fmt_time(iso):
        if not iso: return ""
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(local_tz)
            return dt.strftime("%-I:%M %p")
        except Exception: return iso[:16]

    def fmt_date(iso):
        if not iso: return ""
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(local_tz)
            return dt.strftime("%Y-%m-%d")
        except Exception: return iso[:10]

    def fmth(s):
        if s is None: return ""
        return f"{int(s) / 3600:.2f}"

    def get_week_start(dt_obj):
        return (dt_obj.date() - timedelta(days=(dt_obj.weekday() - week_start_wd) % 7))

    def mat_total(mat_str):
        try:
            mats = json.loads(mat_str or "[]")
            return sum(float(m.get("price") or 0) for m in (mats if isinstance(mats, list) else []))
        except Exception:
            return 0.0

    def calc_entry(e):
        gross  = dt_diff_seconds(e["clock_in"], e["clock_out"]) if e["clock_out"] else 0
        net    = gross if paid_breaks else max(0, gross - (e["total_break_seconds"] or 0))
        if e.get("rate_type") == "none":
            labor = 0.0
        elif e.get("rate_type") == "flat":
            labor = float(e.get("flat_amount") or 0)
        elif e.get("hourly_rate") and net > 0:
            labor = (net / 3600) * float(e["hourly_rate"])
        else:
            labor = 0.0
        travel  = float(e.get("travel_reimb")  or 0)
        parking = float(e.get("parking_tolls") or 0)
        mats    = mat_total(e.get("materials"))
        return net, labor, travel, mats, parking, labor + travel + parking + mats

    def pay_type_str(e):
        rt = e.get("rate_type")
        if rt == "flat": return "Flat"
        if rt == "none": return "Non-Billable"
        return "Hourly"

    def pay_rate_str(e):
        rt = e.get("rate_type")
        if rt == "none":
            return ""
        if rt == "flat":
            return f"${float(e.get('flat_amount') or 0):.2f} flat"
        return f"${e['hourly_rate']}/hr" if e.get("hourly_rate") else ""

    HEADERS = [
        "Date","WO Title","WO Status","Company","Customer","Assignment ID",
        "Pay Type","Pay Rate","Clock In","Clock Out","Total Hours",
        "Total Labor","Travel Reimb","Materials Reimb","Parking/Tolls",
        "Total Expected Pay","Pay Status","Total Received","Received Date","Pay Notes",
    ]
    lines = [",".join(f'"{h}"' for h in HEADERS)]

    def entry_row(e, wk_received=False):
        net, labor, travel, mats, parking, total = calc_entry(e)
        pay_status = ""
        received_str = ""
        rec_date = ""
        # Received data only appears once the week's pay is actually confirmed
        if wk_received:
            override = e.get("received_pay")
            paid = float(override) if override is not None else total
            received_str = f"{paid:.2f}"
            if paid < total - 0.005:
                pay_status = "LOWERED"
            rec_date = (e.get("received_date") or "")[:10]
        return ",".join([
            cell(fmt_date(e["clock_in"])),
            cell(e.get("wo_title") or ""),
            cell((e.get("status") or "pending").upper()),
            cell(e.get("org_name") or ""),
            cell(e.get("client_name") or ""),
            cell(e.get("assignment_id") or ""),
            cell(pay_type_str(e)),
            cell(pay_rate_str(e)),
            cell(fmt_time(e["clock_in"])),
            cell(fmt_time(e["clock_out"])),
            cell(fmth(net)),
            cell(f"{labor:.2f}"),
            cell(f"{travel:.2f}" if travel else ""),
            cell(f"{mats:.2f}"   if mats   else ""),
            cell(f"{parking:.2f}" if parking else ""),
            cell(f"{total:.2f}"),
            cell(pay_status),
            cell(received_str),
            cell(rec_date),
            cell(e.get("pay_adjustment_note") or ""),
        ])

    def summary_row(label, exp, pay_status="", received="", notes="", rec_date="", hours=""):
        return ",".join([
            cell(label), *[cell("")] * 9,
            cell(hours),
            *[cell("")] * 4,
            cell(f"{exp:.2f}"),
            cell(pay_status),
            cell(received),
            cell(rec_date),
            cell(notes),
        ])

    if not multi_week:
        pp = None
        ws_str = None
        if rows:
            try:
                dt0    = datetime.fromisoformat(rows[0]["clock_in"].replace("Z", "+00:00")).astimezone(local_tz)
                ws_str = str(get_week_start(dt0))
                pp     = pay_map.get(ws_str)
            except Exception:
                pass
        wk_received = bool(pp and (pp.get("status") == "received"))
        for e in rows:
            lines.append(entry_row(e, wk_received))
        if rows:
            week_exp = sum(calc_entry(e)[5] for e in rows)
            week_hrs = fmth(sum(calc_entry(e)[0] for e in rows))
            lines.append(summary_row(
                f"WEEK TOTAL{f' ({ws_str})' if ws_str else ''}",
                week_exp,
                ((pp.get("status") or "pending").upper() if pp else "PENDING"),
                f"{float(pp.get('received_amount') or 0):.2f}" if wk_received else "",
                pp.get("notes") or "" if pp else "",
                (pp.get("paid_at") or "")[:10] if wk_received else "",
                week_hrs,
            ))
    else:
        weeks_map = {}
        for e in rows:
            try:
                dt     = datetime.fromisoformat(e["clock_in"].replace("Z", "+00:00")).astimezone(local_tz)
                ws_str = str(get_week_start(dt))
            except Exception:
                ws_str = "0000-00-00"
            weeks_map.setdefault(ws_str, []).append(e)

        month_exp = 0.0
        month_rcv = 0.0
        month_sec = 0
        for ws_str in sorted(weeks_map.keys()):
            entries  = weeks_map[ws_str]
            pp       = pay_map.get(ws_str)
            wk_received = bool(pp and (pp.get("status") == "received"))
            week_exp = sum(calc_entry(e)[5] for e in entries)
            week_sec = sum(calc_entry(e)[0] for e in entries)
            rcv_amt  = float(pp.get("received_amount") or 0) if wk_received else 0.0
            month_exp += week_exp
            month_rcv += rcv_amt
            month_sec += week_sec

            try:
                ws_dt   = datetime.strptime(ws_str, "%Y-%m-%d")
                we_dt   = ws_dt + timedelta(days=6)
                hdr_lbl = f"Week: {ws_dt.strftime('%b %d')} – {we_dt.strftime('%b %d')}"
            except Exception:
                hdr_lbl = f"Week: {ws_str}"

            lines.append(summary_row(
                hdr_lbl, week_exp,
                (pp.get("status") or "").upper() if pp else "",
                f"{rcv_amt:.2f}" if wk_received else "",
                pp.get("notes") or "" if pp else "",
                (pp.get("paid_at") or "")[:10] if wk_received else "",
                fmth(week_sec),
            ))
            for e in entries:
                lines.append(entry_row(e, wk_received))
            lines.append("")

        lines.append(summary_row("MONTH TOTAL", month_exp, "", f"{month_rcv:.2f}", "", "", fmth(month_sec)))

    return "csv", "\n".join(lines)


def h_export_entry_zip(req, groups):
    import io
    import zipfile
    from datetime import timedelta, timezone as _tz

    eid = groups[0]
    params = req.get("query", {})
    tz_offset = int(params.get("tz", [0])[0] or 0)
    local_tz = _tz(timedelta(minutes=-tz_offset))

    with get_db() as db:
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (eid,)).fetchone()
        if not row:
            return 404, {"error": "Not found"}
        entry = attach_breaks(db, row_to_dict(row))
        photos = rows_to_list(db.execute(
            "SELECT * FROM entry_photos WHERE entry_id=? ORDER BY created_at", (eid,)
        ).fetchall())
        settings = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings").fetchall()}

    def fmt_local(iso):
        if not iso: return ""
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(local_tz).strftime("%-I:%M %p")
        except Exception:
            return iso[:16]

    sym = settings.get("currency_symbol") or "$"
    paid_breaks = (settings.get("paid_breaks") or "0") == "1"
    gross = dt_diff_seconds(entry["clock_in"], entry["clock_out"]) if entry.get("clock_out") else 0
    net = gross if paid_breaks else max(0, gross - (entry.get("total_break_seconds") or 0))
    total_hrs = f"{net / 3600:.2f} hrs"

    try:
        mats = json.loads(entry.get("materials") or "[]")
        mats = mats if isinstance(mats, list) else []
    except Exception:
        mats = []
    mats_str = ", ".join(
        m.get("name", "") + (f" - {sym}{m['price']}" if m.get("price") else "")
        for m in mats
    ) or "N/a"

    site_and_id = " #".join(x for x in [entry.get("client_name"), entry.get("site_id")] if x)
    release_code = "N/a" if entry.get("no_release_code") else (entry.get("release_code") or "N/a")
    return_track = "N/a" if entry.get("no_return_track") else (entry.get("return_track") or "N/a")
    parking = f"{sym}{entry['parking_tolls']}" if entry.get("parking_tolls") else "N/a"

    report = f"""Tech name: {settings.get('tech_name') or ''}
Assignment ID: {entry.get('assignment_id') or ''}
Site name & ID: {site_and_id}
Address: {entry.get('address') or ''}
Buyer/Representing company: {entry.get('org_name') or ''}
Onsite (Check in): {fmt_local(entry.get('clock_in'))}
Offsite (Check out): {fmt_local(entry.get('clock_out'))}
Total time: {total_hrs}
Parking/Tolls: {parking}
PM/PC name: {entry.get('pm_pc_name') or 'N/a'}
MOD name: {entry.get('mod_name') or 'N/a'}
NOC name: {entry.get('noc_name') or 'N/a'}
Ticket #: {entry.get('ticket_num') or 'N/a'}
Release code: {release_code}
Return track #: {return_track}
Materials used: {mats_str}
Work summary: {entry.get('work_summary') or ''}
"""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("report.txt", report)
        used_names = set()
        for p in photos:
            folder = p.get("folder") or str(eid)
            fp = UPLOADS_DIR / folder / p["filename"]
            if not fp.exists():
                continue
            arc = f"{p['photo_type']}/{p['filename']}"
            if arc in used_names:
                arc = f"{p['photo_type']}/{p['id']}_{p['filename']}"
            used_names.add(arc)
            zf.write(fp, arcname=arc)

    safe_id = re.sub(r'[^\w-]', '', (entry.get("assignment_id") or f"entry-{eid}"))
    try:
        date_str = datetime.fromisoformat(entry["clock_in"].replace("Z", "+00:00")).astimezone(local_tz).strftime("%Y-%m-%d")
    except Exception:
        date_str = "export"
    return "zip", (f"WO-{safe_id}-{date_str}.zip", buf.getvalue())


# ── Trips ──────────────────────────────────────────────────────────────────────

def h_get_trips(req, _groups):
    params = req.get("query", {})
    frm = params.get("from", [None])[0]
    to  = params.get("to",  [None])[0]
    sql = "SELECT * FROM trips WHERE 1=1"
    args = []
    if frm: sql += " AND start_time >= ?"; args.append(frm)
    if to:  sql += " AND start_time <= ?"; args.append(to)
    sql += " ORDER BY start_time DESC"
    with get_db() as db:
        rows = rows_to_list(db.execute(sql, args).fetchall())
    return 200, rows

def _augment_trip(db, trip_dict):
    if not trip_dict:
        return trip_dict
    tid = trip_dict["id"]
    active_pause = row_to_dict(db.execute(
        "SELECT * FROM trip_pauses WHERE trip_id=? AND pause_end IS NULL", (tid,)
    ).fetchone())
    trip_dict["active_pause"] = active_pause
    return trip_dict


def h_get_current_trip(req, _groups):
    with get_db() as db:
        row = row_to_dict(db.execute(
            "SELECT * FROM trips WHERE status='active' ORDER BY start_time DESC LIMIT 1"
        ).fetchone())
        if not row:
            return 404, {"error": "No active trip"}
        _augment_trip(db, row)
    return 200, row

def h_start_trip(req, _groups):
    data = req.get("body", {})
    category      = (data.get("category") or "Other").strip()
    assignment_id = (data.get("assignment_id") or "").strip() or None
    start_time    = data.get("start_time") or now_iso()
    mileage_start = data.get("mileage_start")
    notes         = data.get("notes")
    with get_db() as db:
        # Insert first to get the auto-increment id, then use it for trip_id
        cur = db.execute(
            "INSERT INTO trips (category, assignment_id, trip_id, folder, start_time, mileage_start, notes) VALUES (?,?,?,?,?,?,?)",
            (category, assignment_id, '', '', start_time, mileage_start, notes)
        )
        db_id  = cur.lastrowid
        trip_id = _trip_id_str(db_id, category, assignment_id)
        folder  = _trip_folder(start_time)
        db.execute("UPDATE trips SET trip_id=?, folder=? WHERE id=?", (trip_id, folder, db_id))
        row = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (db_id,)).fetchone())
        _augment_trip(db, row)
    return 201, row

def h_stop_trip(req, groups):
    tid = groups[0]
    data = req.get("body", {})
    end_time    = data.get("end_time") or now_iso()
    mileage_end = data.get("mileage_end")
    notes       = data.get("notes")
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        settings = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings").fetchall()}
        rate = float(settings.get("mileage_rate") or "0.67")
        distance = None
        tax_ded  = None
        if mileage_end is not None and trip.get("mileage_start") is not None:
            distance = round(float(mileage_end) - float(trip["mileage_start"]), 2)
            tax_ded  = round(max(0, distance) * rate, 2)
        merged_notes = data.get("notes", trip.get("notes"))
        db.execute(
            "UPDATE trips SET end_time=?, mileage_end=?, distance=?, tax_deduction=?, notes=?, status='completed', updated_at=datetime('now') WHERE id=?",
            (end_time, mileage_end, distance, tax_ded, merged_notes, tid)
        )
        row = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
    return 200, row

def h_get_trip(req, groups):
    tid = groups[0]
    with get_db() as db:
        row = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not row:
            return 404, {"error": "Not found"}
        _augment_trip(db, row)
    return 200, row

def h_update_trip(req, groups):
    tid = groups[0]
    data = req.get("body", {})
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        for field in ("category","assignment_id","notes","mileage_start","mileage_end","distance","tax_deduction"):
            if field in data:
                trip[field] = data[field]
        db.execute(
            "UPDATE trips SET category=?,assignment_id=?,notes=?,mileage_start=?,mileage_end=?,distance=?,tax_deduction=?,updated_at=datetime('now') WHERE id=?",
            (trip["category"],trip["assignment_id"],trip["notes"],trip["mileage_start"],trip["mileage_end"],trip["distance"],trip["tax_deduction"],tid)
        )
        row = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
    return 200, row

def h_delete_trip(req, groups):
    tid = groups[0]
    photos = []
    trip_folder = None
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        trip_folder = trip.get("folder")
        photos = rows_to_list(db.execute(
            "SELECT * FROM trip_photos WHERE trip_id=?", (tid,)
        ).fetchall())
        db.execute("DELETE FROM trips WHERE id=?", (tid,))  # CASCADE deletes trip_photos
    for photo in photos:
        folder = photo.get('folder') or trip_folder or str(tid)
        fp = UPLOADS_DIR / folder / photo['filename']
        try: fp.unlink(missing_ok=True)
        except Exception: pass
    return 200, {"success": True}


def h_reassign_trip(req, groups):
    tid = groups[0]
    data = req.get("body", {})
    new_category      = (data.get("category") or "").strip()
    new_assignment_id = (data.get("assignment_id") or "").strip() or None
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        old_category = trip["category"]
        old_trip_id  = trip.get("trip_id") or str(tid)
        folder       = trip.get("folder") or _trip_folder(trip["start_time"])
        category     = new_category or old_category
        new_trip_id  = _trip_id_str(int(tid), category, new_assignment_id)

        # Append reassign note only when category actually changes
        old_notes = (trip.get("notes") or "").strip()
        if old_category != category:
            now_str = datetime.now().strftime('%H:%M')
            reassign_note = f"{now_str} - Reassign from: {old_category} to: {category}"
            new_notes = (old_notes + "\n" + reassign_note).strip() if old_notes else reassign_note
        else:
            new_notes = old_notes or None

        photos = rows_to_list(db.execute("SELECT * FROM trip_photos WHERE trip_id=?", (tid,)).fetchall())

        db.execute(
            "UPDATE trips SET category=?, assignment_id=?, folder=?, trip_id=?, notes=?, updated_at=datetime('now') WHERE id=?",
            (category, new_assignment_id, folder, new_trip_id, new_notes, tid)
        )

        # Rename filenames in DB — folder never moves, only names change
        file_renames = []
        if old_trip_id != new_trip_id:
            for photo in photos:
                old_fname = photo['filename']
                ext = Path(old_fname).suffix or '.jpg'
                new_fname = _trip_photo_filename(
                    trip["start_time"], photo['photo_type'], category, new_trip_id, ext
                )
                if new_fname != old_fname:
                    db.execute("UPDATE trip_photos SET filename=? WHERE id=?", (new_fname, photo['id']))
                    file_renames.append((UPLOADS_DIR / folder / old_fname,
                                         UPLOADS_DIR / folder / new_fname))

        row = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        _augment_trip(db, row)

    # Filesystem: rename photo files in-place (folder never changes)
    for old_file, new_file in file_renames:
        try:
            if old_file.exists():
                old_file.rename(new_file)
        except Exception:
            pass

    return 200, row

def h_get_trip_photos(req, groups):
    tid = groups[0]
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT folder FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        rows = rows_to_list(db.execute(
            "SELECT * FROM trip_photos WHERE trip_id=? ORDER BY created_at", (tid,)
        ).fetchall())
    trip_folder = trip.get("folder") or str(tid)
    for r in rows:
        r['url'] = f"/uploads/{r.get('folder') or trip_folder}/{r['filename']}"
    return 200, rows

def h_post_trip_photo(req, groups):
    tid = groups[0]
    data = req.get("body", {})
    photo_type = (data.get("photo_type") or "before").strip()
    b64data = data.get("data", "")
    original_name = (data.get("filename") or "photo.jpg").strip()
    mime = (data.get("mime") or "image/jpeg").lower()
    if not b64data:
        return 400, {"error": "No image data"}
    try:
        img_bytes = base64.b64decode(b64data)
    except Exception:
        return 400, {"error": "Invalid base64 data"}
    ext = ".jpg"
    if "png" in mime: ext = ".png"
    elif "webp" in mime: ext = ".webp"
    with get_db() as db:
        trip = row_to_dict(db.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone())
        if not trip:
            return 404, {"error": "Not found"}
        settings = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings").fetchall()}
    folder    = trip.get("folder") or _trip_folder(trip["start_time"])
    safe_name = _trip_photo_filename(trip["start_time"], photo_type, trip["category"], trip["trip_id"] or str(tid), ext)
    entry_dir = UPLOADS_DIR / folder
    entry_dir.mkdir(parents=True, exist_ok=True)
    file_path = entry_dir / safe_name
    file_path.write_bytes(img_bytes)
    ftp_remote = f"{folder.replace('/', '_')}_{safe_name}"
    ftp_synced = 1 if ftp_sync_photo(str(file_path), ftp_remote, settings) else 0
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO trip_photos (trip_id, photo_type, filename, folder, original_name, ftp_synced) VALUES (?,?,?,?,?,?)",
            (tid, f"trip_{photo_type}", safe_name, folder, original_name, ftp_synced)
        )
        row = row_to_dict(db.execute("SELECT * FROM trip_photos WHERE id=?", (cur.lastrowid,)).fetchone())
    row['url'] = f"/uploads/{folder}/{safe_name}"
    return 201, row

# ── Projects ────────────────────────────────────────────────────────────────────

def h_get_projects(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute("SELECT * FROM projects ORDER BY name").fetchall())
    return 200, rows

def h_create_project(req, _groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name required"}
    defaults = data.get("defaults")
    defaults_str = json.dumps(defaults) if isinstance(defaults, dict) else (defaults or None)
    with get_db() as db:
        cur = db.execute("INSERT INTO projects (name, defaults) VALUES (?, ?)", (name, defaults_str))
        row = row_to_dict(db.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone())
    return 201, row

def _defaults_est(defaults):
    try:
        d = json.loads(defaults) if isinstance(defaults, str) else (defaults or {})
        return int(d.get("est_minutes") or 0) or None
    except Exception:
        return None


def h_update_project(req, groups):
    pid = groups[0]
    data = req.get("body", {})
    with get_db() as db:
        ex = row_to_dict(db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone())
        if not ex:
            return 404, {"error": "Not found"}
        name = (data.get("name") or ex["name"]).strip()
        defaults = data.get("defaults", ex.get("defaults"))
        defaults_str = json.dumps(defaults) if isinstance(defaults, dict) else (defaults or None)
        archived = 1 if data.get("archived", ex.get("archived", 0)) else 0
        db.execute("UPDATE projects SET name=?, defaults=?, archived=? WHERE id=?", (name, defaults_str, archived, pid))
        row = row_to_dict(db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone())

        # The project's estimate is a default, so it keeps reaching the jobs that
        # never got one of their own — and the ones still carrying the old default.
        # A job with a deliberately different estimate is left alone.
        old_est, new_est = _defaults_est(ex.get("defaults")), _defaults_est(defaults_str)
        followers = []
        if new_est != old_est:
            followers = [r["id"] for r in db.execute(
                "SELECT id FROM planned_jobs WHERE project_id=? AND (est_minutes IS NULL OR est_minutes=?)",
                (pid, old_est if old_est is not None else -1)).fetchall()]
            if followers:
                db.execute(
                    "UPDATE planned_jobs SET est_minutes=? WHERE id IN (%s)" % ",".join("?" * len(followers)),
                    [new_est, *followers])
    for jid in followers:
        caldav_sync_async(jid)      # their calendar events are a different length now
    row["planned_jobs_updated"] = len(followers)
    return 200, row

def h_delete_project(req, groups):
    with get_db() as db:
        cur = db.execute("DELETE FROM projects WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}


# ── Planned jobs ────────────────────────────────────────────────────────────────

PLANNED_SELECT = """
    SELECT pj.*, o.name as org_name, c.name as client_name, pr.name as project_name
    FROM planned_jobs pj
    LEFT JOIN organizations o ON pj.organization_id = o.id
    LEFT JOIN clients c ON pj.client_id = c.id
    LEFT JOIN projects pr ON pj.project_id = pr.id
"""

def h_get_planned_jobs(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute(PLANNED_SELECT + " ORDER BY pj.created_at DESC").fetchall())
    return 200, rows

def h_create_planned_job(req, _groups):
    data = req.get("body", {})
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO planned_jobs
            (wo_title, organization_id, client_id, project_id, assignment_id, site_id,
             address, rate_type, pay_rate_id, flat_amount, travel_reimb, notes,
             planned_date, planned_time, est_minutes, revisit_of,
             ticket_num, inc_num, mod_name, noc_name, pm_pc_name,
             scope_of_work, dispatch_contacts)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (data.get("wo_title"), data.get("organization_id"), data.get("client_id"),
             data.get("project_id"), data.get("assignment_id"), data.get("site_id"),
             data.get("address"), data.get("rate_type", "hourly"), data.get("pay_rate_id"),
             data.get("flat_amount"), data.get("travel_reimb"), data.get("notes"),
             data.get("planned_date"), data.get("planned_time"),
             data.get("est_minutes"), data.get("revisit_of"),
             data.get("ticket_num"), data.get("inc_num"), data.get("mod_name"),
             data.get("noc_name"), data.get("pm_pc_name"),
             data.get("scope_of_work"), data.get("dispatch_contacts"))
        )
        row = row_to_dict(db.execute("SELECT * FROM planned_jobs WHERE id=?", (cur.lastrowid,)).fetchone())
    caldav_sync_async(row["id"])
    return 201, row

PLANNED_JOB_FIELDS = [
    "wo_title", "organization_id", "client_id", "project_id", "assignment_id",
    "site_id", "address", "rate_type", "pay_rate_id", "flat_amount",
    "travel_reimb", "notes", "planned_date", "planned_time", "est_minutes", "revisit_of",
    "ticket_num", "inc_num", "mod_name", "noc_name", "pm_pc_name",
    "scope_of_work", "dispatch_contacts",
]

def h_update_planned_job(req, groups):
    pid = groups[0]
    data = req.get("body", {})
    with get_db() as db:
        ex = row_to_dict(db.execute("SELECT * FROM planned_jobs WHERE id=?", (pid,)).fetchone())
        if not ex:
            return 404, {"error": "Not found"}
        vals = [data.get(f, ex.get(f)) for f in PLANNED_JOB_FIELDS]
        db.execute(
            f"UPDATE planned_jobs SET {', '.join(f + '=?' for f in PLANNED_JOB_FIELDS)} WHERE id=?",
            (*vals, pid)
        )
        row = row_to_dict(db.execute("SELECT * FROM planned_jobs WHERE id=?", (pid,)).fetchone())
    caldav_sync_async(row["id"])
    return 200, row

def h_delete_planned_job(req, groups):
    with get_db() as db:
        row = row_to_dict(db.execute("SELECT calendar_uid FROM planned_jobs WHERE id=?", (groups[0],)).fetchone())
        cur = db.execute("DELETE FROM planned_jobs WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    caldav_delete_async((row or {}).get("calendar_uid"))
    return 200, {"success": True}


def h_planned_job_ics(req, groups):
    """Plain .ics download — works with any calendar, no credentials needed."""
    with get_db() as db:
        job = row_to_dict(db.execute(PLANNED_SELECT + " WHERE pj.id=?", (groups[0],)).fetchone())
    if not job:
        return 404, {"error": "Not found"}
    with get_db() as db:
        s = caldav_settings(db)
    uid, ics = build_vevent(job, s.get("caldav_duration_min", "60"))
    if not ics:
        return 400, {"error": "This job has no planned date yet"}
    name = re.sub(r'[^\w-]', '', (job.get("wo_title") or f"job-{job['id']}").replace(" ", "-"))[:40]
    return "ics", (f"{name or 'planned-job'}.ics", ics)


def h_caldav_test(req, _groups):
    """Verify credentials and list the calendars available to the user."""
    data = req.get("body", {})
    with get_db() as db:
        s = caldav_settings(db)
    # allow testing values typed in the form before they are saved
    for k in ("caldav_url", "caldav_user", "caldav_password", "caldav_calendar"):
        if data.get(k):
            s[k] = data[k]
    base, err = caldav_normalize_url(s.get("caldav_url"))
    if err:
        return 200, {"ok": False, "error": err}
    if not (base and s.get("caldav_user") and s.get("caldav_password")):
        return 400, {"error": "URL, user and app password are required"}

    body = ('<?xml version="1.0" encoding="utf-8"?>'
            '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">'
            '<d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>')
    url = f"{base}/remote.php/dav/calendars/{quote(s['caldav_user'])}/"
    try:
        resp = _caldav_request(s, "PROPFIND", url, body,
                               {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"})
        xml = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        hint = "wrong user or app password" if exc.code in (401, 403) else \
               "calendar path not found — check the Nextcloud URL" if exc.code == 404 else ""
        return 200, {"ok": False, "url": base,
                     "error": f"HTTP {exc.code} {exc.reason}" + (f" ({hint})" if hint else "")}
    except Exception as exc:
        return 200, {"ok": False, "url": base, "error": caldav_url_error(exc, url)}

    calendars = []
    try:
        root = ET.fromstring(xml)
        ns = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav"}
        for resp_el in root.findall("d:response", ns):
            href = (resp_el.findtext("d:href", "", ns) or "").rstrip("/")
            is_cal = resp_el.find(".//c:calendar", ns) is not None
            if not is_cal:
                continue
            name = resp_el.findtext(".//d:displayname", "", ns) or href.rsplit("/", 1)[-1]
            calendars.append({"slug": unquote(href.rsplit("/", 1)[-1]), "name": name})
    except ET.ParseError as exc:
        return 200, {"ok": False, "error": f"Unexpected response from the server: {exc}"}

    chosen = (s.get("caldav_calendar") or "personal").strip()
    exists = any(c["slug"] == chosen for c in calendars)
    # Reading the calendar list is not the thing that has been failing — writing is.
    write_error = caldav_probe_calendar(s) if exists else None
    return 200, {
        "ok": write_error is None,
        "url": base,
        "calendars": calendars,
        "selected_exists": exists,
        "selected": chosen,
        "error": write_error,
    }


def h_caldav_sync_all(req, _groups):
    """Re-push everything — planned jobs and the whole work-order history."""
    s = caldav_settings()
    if not caldav_ready(s):
        return 400, {"error": "Calendar sync is off or not configured"}
    return 200, caldav_backfill(force=True, settings=s)


# ── Trip categories ─────────────────────────────────────────────────────────────

def h_get_trip_categories(req, _groups):
    with get_db() as db:
        rows = rows_to_list(db.execute("SELECT * FROM trip_categories ORDER BY sort_order, name").fetchall())
    return 200, rows

def h_create_trip_category(req, _groups):
    data = req.get("body", {})
    name = (data.get("name") or "").strip()
    if not name:
        return 400, {"error": "Name required"}
    with get_db() as db:
        try:
            cur = db.execute("INSERT INTO trip_categories (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM trip_categories))", (name,))
            row = row_to_dict(db.execute("SELECT * FROM trip_categories WHERE id=?", (cur.lastrowid,)).fetchone())
        except Exception:
            return 409, {"error": "Category already exists"}
    return 201, row

def h_delete_trip_category(req, groups):
    cid = groups[0]
    with get_db() as db:
        cur = db.execute("DELETE FROM trip_categories WHERE id=?", (cid,))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}

# ── Mileage CSV export ──────────────────────────────────────────────────────────

def h_export_mileage_csv(req, _groups):
    from datetime import timedelta
    params = req.get("query", {})
    frm = params.get("from", [None])[0]
    to  = params.get("to",  [None])[0]
    sql = "SELECT * FROM trips WHERE status='completed'"
    args = []
    if frm: sql += " AND start_time >= ?"; args.append(frm)
    if to:  sql += " AND start_time <= ?"; args.append(to)
    sql += " ORDER BY start_time ASC"
    with get_db() as db:
        rows = rows_to_list(db.execute(sql, args).fetchall())

    def cell(v): return '"' + str(v or "").replace('"','""') + '"'
    def fmt_dt(iso):
        if not iso: return ""
        try: return datetime.fromisoformat(iso.replace("Z","+00:00")).strftime("%Y-%m-%d %H:%M")
        except: return iso[:16]
    def fmth(s):
        if not s and s != 0: return ""
        s = int(s); return f"{s//3600}:{str((s%3600)//60).zfill(2)}"

    headers = ["Date/Time","TripID","Driving Time","Mileage Start","Mileage End","Distance","Write-Off Amount","Trip Category","Note"]
    lines = [",".join(f'"{h}"' for h in headers)]

    total_dist = 0.0; total_tax = 0.0; total_sec = 0
    for t in rows:
        start_sec = 0
        if t.get("start_time") and t.get("end_time"):
            try:
                s = datetime.fromisoformat(t["start_time"].replace("Z","+00:00"))
                e = datetime.fromisoformat(t["end_time"].replace("Z","+00:00"))
                start_sec = int((e - s).total_seconds())
            except: pass
        dist = float(t.get("distance") or 0)
        tax  = float(t.get("tax_deduction") or 0)
        total_dist += dist; total_tax += tax; total_sec += start_sec
        lines.append(",".join([
            cell(fmt_dt(t.get("start_time"))),
            cell(t.get("trip_id") or ""),
            cell(fmth(start_sec)),
            cell(str(t.get("mileage_start") or "")),
            cell(str(t.get("mileage_end") or "")),
            cell(f"{dist:.2f}" if t.get("distance") is not None else ""),
            cell(f"{tax:.2f}" if t.get("tax_deduction") is not None else ""),
            cell(t.get("category") or ""),
            cell(t.get("notes") or ""),
        ]))

    lines.append(",".join([
        cell("TOTALS"), cell(""), cell(fmth(total_sec)),
        cell(""), cell(""),
        cell(f"{total_dist:.2f}"),
        cell(f"{total_tax:.2f}"),
        cell(""), cell(""),
    ]))
    return "csv", "\n".join(lines)


# ── Routes ─────────────────────────────────────────────────────────────────────

ROUTES = [
    (r"/api/entries/current",           ["GET"],    h_get_current),
    (r"/api/entries",                   ["GET"],    h_get_entries),
    (r"/api/entries",                   ["POST"],   h_post_entry),
    (r"/api/entries/(\d+)",             ["PUT"],    h_put_entry),
    (r"/api/entries/(\d+)/clockout",    ["POST"],   h_clockout),
    (r"/api/entries/(\d+)/break/start", ["POST"],   h_start_break),
    (r"/api/entries/(\d+)/break/end",   ["POST"],   h_end_break),
    (r"/api/entries/(\d+)",             ["DELETE"], h_delete_entry),
    (r"/api/entries/(\d+)/photos",          ["GET"],    h_get_photos),
    (r"/api/entries/(\d+)/photos",          ["POST"],   h_post_photo),
    (r"/api/entries/(\d+)/photos/(\d+)",    ["DELETE"], h_delete_photo),
    (r"/api/entries/(\d+)/export/zip",      ["GET"],    h_export_entry_zip),
    (r"/api/pay-periods",              ["GET"],  h_get_pay_periods),
    (r"/api/pay-periods",              ["POST"], h_upsert_pay_period),
    (r"/api/trips/current",                ["GET"],    h_get_current_trip),
    (r"/api/trips/(\d+)/stop",             ["POST"],   h_stop_trip),
    (r"/api/trips/(\d+)/reassign",         ["POST"],   h_reassign_trip),
    (r"/api/trips/(\d+)/pause/start",      ["POST"],   h_start_trip_pause),
    (r"/api/trips/(\d+)/pause/end",        ["POST"],   h_end_trip_pause),
    (r"/api/trips/(\d+)/photos",           ["GET","POST"], lambda req,g: h_get_trip_photos(req,g) if req["method"]=="GET" else h_post_trip_photo(req,g)),
    (r"/api/trips/(\d+)",                  ["GET","PUT","DELETE"], lambda req,g: h_get_trip(req,g) if req["method"]=="GET" else h_update_trip(req,g) if req["method"]=="PUT" else h_delete_trip(req,g)),
    (r"/api/trips",                        ["GET","POST"], lambda req,g: h_get_trips(req,g) if req["method"]=="GET" else h_start_trip(req,g)),
    (r"/api/trip-categories/(\d+)",        ["DELETE"], h_delete_trip_category),
    (r"/api/trip-categories",              ["GET","POST"], lambda req,g: h_get_trip_categories(req,g) if req["method"]=="GET" else h_create_trip_category(req,g)),
    (r"/api/reports/mileage/export/csv",   ["GET"],    h_export_mileage_csv),
    (r"/api/organizations",             ["GET"],    h_get_orgs),
    (r"/api/organizations",             ["POST"],   h_post_org),
    (r"/api/organizations/(\d+)",       ["PUT"],    h_put_org),
    (r"/api/organizations/(\d+)",       ["DELETE"], h_delete_org),
    (r"/api/clients",                   ["GET"],    h_get_clients),
    (r"/api/clients",                   ["POST"],   h_post_client),
    (r"/api/clients/(\d+)",             ["PUT"],    h_put_client),
    (r"/api/clients/(\d+)",             ["DELETE"], h_delete_client),
    (r"/api/pay-rates",                 ["GET"],    h_get_rates),
    (r"/api/pay-rates",                 ["POST"],   h_post_rate),
    (r"/api/pay-rates/(\d+)",           ["PUT"],    h_put_rate),
    (r"/api/pay-rates/(\d+)",           ["DELETE"], h_delete_rate),
    (r"/api/projects",                  ["GET"],    h_get_projects),
    (r"/api/projects",                  ["POST"],   h_create_project),
    (r"/api/projects/(\d+)",            ["PUT"],    h_update_project),
    (r"/api/projects/(\d+)",            ["DELETE"], h_delete_project),
    (r"/api/planned-jobs",              ["GET"],    h_get_planned_jobs),
    (r"/api/planned-jobs",              ["POST"],   h_create_planned_job),
    (r"/api/planned-jobs/(\d+)",        ["PUT"],    h_update_planned_job),
    (r"/api/planned-jobs/(\d+)/ics",    ["GET"],    h_planned_job_ics),
    (r"/api/planned-jobs/(\d+)",        ["DELETE"], h_delete_planned_job),
    (r"/api/caldav/test",               ["POST"],   h_caldav_test),
    (r"/api/caldav/sync-all",           ["POST"],   h_caldav_sync_all),
    (r"/api/settings",                  ["GET"],    h_get_settings),
    (r"/api/settings",                  ["PUT"],    h_put_settings),
    (r"/api/reports/export/csv",        ["GET"],    h_export_csv),
]


# ── Request handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            raw = self.rfile.read(length)
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    def _send(self, status, body, content_type="application/json"):
        if content_type == "application/json":
            data = json.dumps(body, default=str).encode()
        else:
            data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_csv(self, content):
        fn = f"timeclock-export-{datetime.now().strftime('%Y-%m-%d')}.csv"
        data = ("﻿" + content).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{fn}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_ics(self, result):
        fn, text = result
        data = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{fn}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_zip(self, result):
        fn, data = result
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f'attachment; filename="{fn}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, path):
        path = unquote(path)
        if path.startswith('/uploads/'):
            rel = path[len('/uploads/'):]
            file_path = (UPLOADS_DIR / rel).resolve()
            try:
                file_path.relative_to(UPLOADS_DIR.resolve())
            except ValueError:
                self._send(403, {"error": "Forbidden"})
                return
            if not file_path.exists():
                self._send(404, {"error": "Not found"})
                return
            img_mime = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                        '.gif': 'image/gif', '.webp': 'image/webp',
                        '.pdf': 'application/pdf'}.get(file_path.suffix.lower(), 'application/octet-stream')
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", img_mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        rel = path.lstrip("/") or "index.html"
        file_path = (PUBLIC / rel).resolve()
        try:
            file_path.relative_to(PUBLIC.resolve())
        except ValueError:
            self._send(403, {"error": "Forbidden"})
            return
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists():
            file_path = PUBLIC / "index.html"
        suffix = file_path.suffix.lower()
        mime = MIME.get(suffix, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if not path.startswith("/api/"):
            if method == "GET":
                self._serve_static(path)
            else:
                self._send(405, {"error": "Method not allowed"})
            return

        handler, groups = route(path, method, ROUTES)
        if handler is None:
            self._send(404, {"error": "Not found"})
            return

        body = self._read_body() if method in ("POST", "PUT", "PATCH") else {}
        req = {"body": body, "query": query, "path": path, "method": method}

        try:
            status, result = handler(req, groups or ())
        except Exception as exc:
            print(f"ERROR {method} {path}: {exc}", file=sys.stderr)
            self._send(500, {"error": str(exc)})
            return

        if status == "csv":
            self._send_csv(result)
        elif status == "zip":
            self._send_zip(result)
        elif status == "ics":
            self._send_ics(result)
        else:
            self._send(status, result)

    def do_GET(self):    self.handle_request("GET")
    def do_HEAD(self):   self.handle_request("GET")
    def do_POST(self):   self.handle_request("POST")
    def do_PUT(self):    self.handle_request("PUT")
    def do_DELETE(self): self.handle_request("DELETE")
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET,HEAD,POST,PUT,DELETE,OPTIONS")
        self.end_headers()


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    migrate_db()
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    # Anything the calendar missed while Nextcloud was down gets pushed now.
    caldav_backfill_async()
    # Threaded so a slow outbound sync (CalDAV / FTP) can't stall the UI
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"TimeClock running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
