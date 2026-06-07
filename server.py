#!/usr/bin/env python3
"""TimeClock backend — stdlib only (sqlite3 + http.server)."""

import json
import os
import re
import sqlite3
import sys
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
}


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
        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('break_reminder_minutes', '120'),
            ('break_return_minutes', '10'),
            ('currency_symbol', '$'),
            ('week_start', '1'),
            ('tech_name', ''),
            ('breaks_enabled', '1'),
            ('paid_breaks', '0'),
            ('break_frequency_minutes', '120'),
            ('break_length_minutes', '15');
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
    ]
    with get_db() as db:
        for stmt in migrations:
            try:
                db.execute(stmt)
            except Exception:
                pass  # column or row already exists


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


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
    with get_db() as db:
        ex = row_to_dict(db.execute("SELECT * FROM time_entries WHERE id=?", (eid,)).fetchone())
        if not ex:
            return 404, {"error": "Not found"}
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
                status=?, release_code=?, no_release_code=?, materials=?
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
            eid
        ))
        row = db.execute(ENTRY_SELECT + " WHERE e.id=?", (eid,)).fetchone()
        entry = attach_breaks(db, row_to_dict(row))
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


def h_delete_entry(req, groups):
    with get_db() as db:
        cur = db.execute("DELETE FROM time_entries WHERE id=?", (groups[0],))
        if cur.rowcount == 0:
            return 404, {"error": "Not found"}
    return 200, {"success": True}


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
    params = req.get("query", {})
    frm = params.get("from", [None])[0]
    to  = params.get("to", [None])[0]

    sql = ENTRY_SELECT + " WHERE 1=1"
    args = []
    if frm:
        sql += " AND e.clock_in >= ?"; args.append(frm)
    if to:
        sql += " AND e.clock_in <= ?"; args.append(to)
    sql += " ORDER BY e.clock_in ASC"

    with get_db() as db:
        rows = rows_to_list(db.execute(sql, args).fetchall())

    DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    lines = ["Date,Day,WO Title,Company,Customer,Site ID,Assignment ID,Ticket #,INC #,MOD Name,NOC Name,PM/PC Name,Pay Rate,Rate Type,Rate,Currency,Clock In,Clock Out,Gross Hours,Break Hours,Net Hours,Total Labor,Travel Reimb,Parking/Tolls,Total Expected,Received Pay,Pay Status,Status,Release Code,Return Track #,Materials,Address,Work Summary"]

    def fmth(s):
        return f"{s//3600}:{str((s%3600)//60).zfill(2)}"

    def cell(v):
        return '"' + str(v or "").replace('"', '""') + '"'

    def fmt_time(iso):
        if not iso:
            return ""
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%H:%M")
        except Exception:
            return iso[:16]

    def fmt_date(iso):
        if not iso:
            return ""
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return iso[:10]

    total_net = 0; total_earn = 0
    for e in rows:
        gross = dt_diff_seconds(e["clock_in"], e["clock_out"]) if e["clock_out"] else 0
        net = max(0, gross - (e["total_break_seconds"] or 0))
        earn = (net / 3600 * e["hourly_rate"]) if (e["hourly_rate"] and net > 0) else 0
        total_net += net; total_earn += earn
        try:
            wd = datetime.fromisoformat(e["clock_in"].replace("Z","+00:00")).weekday()
            day_name = DAYS[wd]
        except Exception:
            day_name = ""
        rate_val = e["hourly_rate"] if e.get("rate_type","hourly") == "hourly" else e.get("flat_amount","")
        labor = earn
        travel = float(e.get("travel_reimb") or 0)
        parking_amt = 0
        try:
            parking_amt = float(e.get("parking_tolls") or 0)
        except (ValueError, TypeError):
            parking_amt = 0
        total_exp = labor + travel + parking_amt
        recv = e.get("received_pay")
        if recv is None:
            recv = total_exp
        pay_status = "PAID" if recv >= total_exp else ("PARTIAL" if recv > 0 else "PENDING")
        lines.append(",".join([
            cell(fmt_date(e["clock_in"])),
            cell(day_name),
            cell(e.get("wo_title") or ""),
            cell(e["org_name"] or ""),
            cell(e["client_name"] or ""),
            cell(e.get("site_id") or ""),
            cell(e.get("assignment_id") or ""),
            cell(e.get("ticket_num") or ""),
            cell(e.get("inc_num") or ""),
            cell(e.get("mod_name") or ""),
            cell(e.get("noc_name") or ""),
            cell(e.get("pm_pc_name") or ""),
            cell(e["rate_name"] or ""),
            cell(e.get("rate_type") or "hourly"),
            cell(rate_val or ""),
            cell(e["currency"] or ""),
            cell(fmt_time(e["clock_in"])),
            cell(fmt_time(e["clock_out"])),
            cell(fmth(gross)),
            cell(fmth(e["total_break_seconds"] or 0)),
            cell(fmth(net)),
            cell(f"{labor:.2f}"),
            cell(f"{travel:.2f}"),
            cell(e.get("parking_tolls") or ""),
            cell(f"{total_exp:.2f}"),
            cell(f"{recv:.2f}"),
            cell(pay_status),
            cell(e.get("status") or ""),
            cell(e.get("release_code") or ("N/a" if e.get("no_release_code") else "")),
            cell(e.get("return_track") or ("N/a" if e.get("no_return_track") else "")),
            cell(e.get("materials") or ""),
            cell(e["address"] or ""),
            cell(e.get("work_summary") or ""),
        ]))

    th = total_net // 3600; tm = (total_net % 3600) // 60
    lines.append(f'"","","","","","","","","","","","","","","","","TOTAL","","","{th}:{str(tm).zfill(2)}","{total_earn:.2f}","","","","","","","","","","","","",""')
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

    def _serve_static(self, path):
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
        req = {"body": body, "query": query, "path": path}

        try:
            status, result = handler(req, groups or ())
        except Exception as exc:
            print(f"ERROR {method} {path}: {exc}", file=sys.stderr)
            self._send(500, {"error": str(exc)})
            return

        if status == "csv":
            self._send_csv(result)
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
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"TimeClock running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
