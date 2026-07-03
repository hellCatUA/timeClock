#!/usr/bin/env python3
"""TimeClock backend — stdlib only (sqlite3 + http.server)."""

import base64
import ftplib
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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
            ('mileage_rate', '0.67');
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
           p.name as rate_name, p.rate as hourly_rate, p.currency
    FROM time_entries e
    LEFT JOIN organizations o ON e.organization_id = o.id
    LEFT JOIN clients c ON e.client_id = c.id
    LEFT JOIN pay_rates p ON e.pay_rate_id = p.id
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
             status, release_code, no_release_code, materials)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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
             1 if data.get("no_release_code") else 0, materials_str)
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
                pay_adjustment=?, pay_adjustment_note=?
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
            revisit_required=?, received_pay=?
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
             data.get("received_pay", entry.get("received_pay")),
             eid))
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (eid,)).fetchone()
        result = row_to_dict(row)
        result["breaks"] = breaks
        result["active_break"] = None
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
        cur = db.execute("DELETE FROM time_entries WHERE id=?", (eid,))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    for photo in photos:
        fp = UPLOADS_DIR / (photo.get('folder') or str(eid)) / photo['filename']
        try: fp.unlink(missing_ok=True)
        except Exception: pass
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
    "OffClock Tools/Supplies": "ONT",
    "OnClock Tools/Supplies":  "OFFT",
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

def h_get_settings(req, _groups):
    with get_db() as db:
        rows = db.execute("SELECT key, value FROM settings").fetchall()
    return 200, {r["key"]: r["value"] for r in rows}


def h_put_settings(req, _groups):
    data = req.get("body", {})
    with get_db() as db:
        for k, v in data.items():
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (str(k), str(v)))
        rows = db.execute("SELECT key, value FROM settings").fetchall()
    return 200, {r["key"]: r["value"] for r in rows}


# ── Reports ────────────────────────────────────────────────────────────────────

def h_week_report(req, _groups):
    params = req.get("query", {})
    date_str = params.get("date", [None])[0]

    with get_db() as db:
        week_start_setting = db.execute("SELECT value FROM settings WHERE key='week_start'").fetchone()
        week_start_day = int((week_start_setting["value"] if week_start_setting else "1"))

    try:
        ref = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc) if date_str else datetime.now(timezone.utc)
    except Exception:
        ref = datetime.now(timezone.utc)

    ref = ref.replace(hour=0, minute=0, second=0, microsecond=0)
    current_weekday = ref.weekday()
    start_weekday = (week_start_day - 1) % 7
    diff = (current_weekday - start_weekday) % 7
    from datetime import timedelta
    week_start = ref - timedelta(days=diff)
    week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)

    ws_iso = week_start.isoformat()
    we_iso = week_end.isoformat()

    with get_db() as db:
        rows = rows_to_list(db.execute(
            ENTRY_SELECT + " WHERE e.clock_in >= ? AND e.clock_in <= ? ORDER BY e.clock_in ASC",
            (ws_iso, we_iso)
        ).fetchall())
        entries = [attach_breaks(db, r) for r in rows]

    total_net = 0
    total_earn = 0
    for e in entries:
        if e["clock_out"]:
            gross = dt_diff_seconds(e["clock_in"], e["clock_out"])
            net = max(0, gross - (e["total_break_seconds"] or 0))
        else:
            net = None
        e["gross_seconds"] = dt_diff_seconds(e["clock_in"], e["clock_out"]) if e["clock_out"] else None
        e["net_seconds"] = net
        earn = (net / 3600 * e["hourly_rate"]) if (net is not None and e["hourly_rate"]) else None
        e["earnings"] = earn
        if net is not None:
            total_net += net
        if earn is not None:
            total_earn += earn

    return 200, {
        "week_start": ws_iso,
        "week_end": we_iso,
        "entries": entries,
        "total_net_seconds": total_net,
        "total_earnings": total_earn,
    }


def h_month_report(req, _groups):
    params = req.get("query", {})
    date_str = params.get("date", [None])[0]
    from datetime import timedelta

    try:
        ref = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc) if date_str else datetime.now(timezone.utc)
    except Exception:
        ref = datetime.now(timezone.utc)

    month_start = ref.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1) - timedelta(seconds=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1) - timedelta(seconds=1)

    with get_db() as db:
        week_start_setting = db.execute("SELECT value FROM settings WHERE key='week_start'").fetchone()
        week_start_day = int((week_start_setting["value"] if week_start_setting else "1"))
        rows = rows_to_list(db.execute(
            ENTRY_SELECT + " WHERE e.clock_in >= ? AND e.clock_in <= ? ORDER BY e.clock_in ASC",
            (month_start.isoformat(), month_end.isoformat())
        ).fetchall())
        entries = [attach_breaks(db, r) for r in rows]

    for e in entries:
        if e["clock_out"]:
            gross = dt_diff_seconds(e["clock_in"], e["clock_out"])
            net = max(0, gross - (e["total_break_seconds"] or 0))
        else:
            net = None
        e["gross_seconds"] = dt_diff_seconds(e["clock_in"], e["clock_out"]) if e["clock_out"] else None
        e["net_seconds"] = net
        earn = (net / 3600 * e["hourly_rate"]) if (net is not None and e["hourly_rate"] and e.get("rate_type") != "flat") else (e.get("flat_amount") if e.get("rate_type") == "flat" else None)
        e["earnings"] = earn

    return 200, {
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "week_start_day": week_start_day,
        "entries": entries,
    }


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
        if e.get("rate_type") == "flat":
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
        return "Flat" if e.get("rate_type") == "flat" else "Hourly"

    def pay_rate_str(e):
        if e.get("rate_type") == "flat":
            return f"${float(e.get('flat_amount') or 0):.2f} flat"
        return f"${e['hourly_rate']}/hr" if e.get("hourly_rate") else ""

    HEADERS = [
        "Date","WO Title","WO Status","Company","Customer","Assignment ID",
        "Pay Type","Pay Rate","Clock In","Clock Out","Total Hours",
        "Total Labor","Travel Reimb","Materials Reimb","Parking/Tolls",
        "Total Expected Pay","Pay Status","Total Received","Pay Notes",
    ]
    lines = [",".join(f'"{h}"' for h in HEADERS)]

    def entry_row(e):
        net, labor, travel, mats, parking, total = calc_entry(e)
        override = e.get("received_pay")
        pay_status = ""
        received_str = ""
        if override is not None:
            override = float(override)
            received_str = f"{override:.2f}"
            if override < total - 0.005:
                pay_status = "DECREASED"
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
            cell(e.get("pay_adjustment_note") or ""),
        ])

    def summary_row(label, exp, pay_status="", received="", notes=""):
        return ",".join([
            cell(label), *[cell("")] * 14,
            cell(f"{exp:.2f}"),
            cell(pay_status),
            cell(received),
            cell(notes),
        ])

    if not multi_week:
        for e in rows:
            lines.append(entry_row(e))
        if rows:
            try:
                dt0    = datetime.fromisoformat(rows[0]["clock_in"].replace("Z", "+00:00"))
                ws_str = str(get_week_start(dt0))
                pp     = pay_map.get(ws_str)
                if pp:
                    week_exp = sum(calc_entry(e)[5] for e in rows)
                    lines.append(summary_row(
                        f"Week: {ws_str}",
                        week_exp,
                        (pp.get("status") or "pending").upper(),
                        f"{float(pp.get('received_amount') or 0):.2f}",
                        pp.get("notes") or "",
                    ))
            except Exception:
                pass
    else:
        weeks_map = {}
        for e in rows:
            try:
                dt     = datetime.fromisoformat(e["clock_in"].replace("Z", "+00:00"))
                ws_str = str(get_week_start(dt))
            except Exception:
                ws_str = "0000-00-00"
            weeks_map.setdefault(ws_str, []).append(e)

        month_exp = 0.0
        month_rcv = 0.0
        for ws_str in sorted(weeks_map.keys()):
            entries  = weeks_map[ws_str]
            pp       = pay_map.get(ws_str)
            week_exp = sum(calc_entry(e)[5] for e in entries)
            rcv_amt  = float(pp.get("received_amount") or 0) if pp else 0.0
            month_exp += week_exp
            month_rcv += rcv_amt

            try:
                ws_dt   = datetime.strptime(ws_str, "%Y-%m-%d")
                we_dt   = ws_dt + timedelta(days=6)
                hdr_lbl = f"Week: {ws_dt.strftime('%b %d')} – {we_dt.strftime('%b %d')}"
            except Exception:
                hdr_lbl = f"Week: {ws_str}"

            lines.append(summary_row(
                hdr_lbl, week_exp,
                (pp.get("status") or "").upper() if pp else "",
                f"{rcv_amt:.2f}" if pp else "",
                pp.get("notes") or "" if pp else "",
            ))
            for e in entries:
                lines.append(entry_row(e))
            lines.append("")

        lines.append(summary_row("MONTH TOTAL", month_exp, "", f"{month_rcv:.2f}", ""))

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
    (r"/api/settings",                  ["GET"],    h_get_settings),
    (r"/api/settings",                  ["PUT"],    h_put_settings),
    (r"/api/reports/week",              ["GET"],    h_week_report),
    (r"/api/reports/month",             ["GET"],    h_month_report),
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

    def _send_zip(self, result):
        fn, data = result
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f'attachment; filename="{fn}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, path):
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
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"TimeClock running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
