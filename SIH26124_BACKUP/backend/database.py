"""
RoadGuard AI — SQLite Database Layer
Tables: videos, detections, incidents
All async via aiosqlite.
"""
import aiosqlite
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "roadguard.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT,
    status TEXT DEFAULT 'uploaded',
    uploaded_at TEXT DEFAULT (datetime('now')),
    duration REAL,
    total_frames INTEGER,
    processed_frames INTEGER DEFAULT 0,
    gps_lat REAL,
    gps_lng REAL,
    gps_end_lat REAL,
    gps_end_lng REAL
);

CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    confidence REAL NOT NULL,
    frame_number INTEGER,
    timestamp TEXT DEFAULT (datetime('now')),
    lat REAL,
    lng REAL,
    bbox_x REAL,
    bbox_y REAL,
    bbox_w REAL,
    bbox_h REAL,
    FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'LOW',
    confidence REAL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    video_id INTEGER,
    detection_id INTEGER,
    status TEXT DEFAULT 'open',
    description TEXT,
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (detection_id) REFERENCES detections(id)
);
"""


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


# ── Videos ──────────────────────────────────────────────
async def create_video(filename, original_name, gps_lat=None, gps_lng=None,
                       gps_end_lat=None, gps_end_lng=None):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """INSERT INTO videos (filename, original_name, gps_lat, gps_lng, gps_end_lat, gps_end_lng)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (filename, original_name, gps_lat, gps_lng, gps_end_lat, gps_end_lng)
        )
        await db.commit()
        row = await db.execute_fetchall("SELECT * FROM videos WHERE id = ?", (cursor.lastrowid,))
        return dict(row[0])


async def update_video(video_id, **kwargs):
    if not kwargs:
        return await get_video(video_id)
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values()) + [video_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE videos SET {sets} WHERE id = ?", vals)
        await db.commit()
    return await get_video(video_id)


async def get_video(video_id):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM videos WHERE id = ?", (video_id,))
        return dict(rows[0]) if rows else None

async def get_videos(limit=50):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM videos ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

async def create_detection(video_id, det_type, confidence, frame_number,
                           bbox_x=0, bbox_y=0, bbox_w=0, bbox_h=0, lat=None, lng=None):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """INSERT INTO detections (video_id, type, confidence, frame_number,
               bbox_x, bbox_y, bbox_w, bbox_h, lat, lng)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (video_id, det_type, confidence, frame_number, bbox_x, bbox_y, bbox_w, bbox_h, lat, lng)
        )
        await db.commit()
        rows = await db.execute_fetchall("SELECT * FROM detections WHERE id = ?", (cursor.lastrowid,))
        return dict(rows[0])


async def get_detections(video_id=None, limit=100):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if video_id:
            rows = await db.execute_fetchall(
                "SELECT * FROM detections WHERE video_id = ? ORDER BY id DESC LIMIT ?",
                (video_id, limit))
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM detections ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]


# ── Incidents ───────────────────────────────────────────
async def create_incident(inc_type, severity, confidence, lat, lng,
                          video_id=None, detection_id=None, description=None, timestamp=None):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        ts = timestamp or datetime.utcnow().isoformat()
        cursor = await db.execute(
            """INSERT INTO incidents (type, severity, confidence, lat, lng,
               video_id, detection_id, description, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (inc_type, severity, confidence, lat, lng, video_id, detection_id, description, ts)
        )
        await db.commit()
        rows = await db.execute_fetchall("SELECT * FROM incidents WHERE id = ?", (cursor.lastrowid,))
        return dict(rows[0])


async def get_incident(incident_id):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM incidents WHERE id = ?", (incident_id,))
        return dict(rows[0]) if rows else None


async def get_incidents(status=None, inc_type=None, severity=None, video_id=None, limit=100):
    query = "SELECT * FROM incidents WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if inc_type:
        query += " AND type = ?"
        params.append(inc_type)
    if severity:
        query += " AND severity = ?"
        params.append(severity)
    if video_id is not None:
        query += " AND video_id = ?"
        params.append(video_id)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(query, params)
        return [dict(r) for r in rows]


async def update_incident(incident_id, **kwargs):
    if not kwargs:
        return await get_incident(incident_id)
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values()) + [incident_id]
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(f"UPDATE incidents SET {sets} WHERE id = ?", vals)
        await db.commit()
        rows = await db.execute_fetchall("SELECT * FROM incidents WHERE id = ?", (incident_id,))
        return dict(rows[0]) if rows else None


async def delete_incident(incident_id):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM incidents WHERE id = ?", (incident_id,))
        await db.commit()
        return True


async def get_stats():
    async with aiosqlite.connect(DB_PATH) as db:
        stats = {}
        row = await db.execute_fetchall("SELECT COUNT(*) FROM incidents")
        stats["total_incidents"] = row[0][0]

        row = await db.execute_fetchall("SELECT COUNT(*) FROM incidents WHERE status = 'open'")
        stats["open_incidents"] = row[0][0]

        row = await db.execute_fetchall("SELECT COUNT(*) FROM incidents WHERE severity = 'CRITICAL'")
        stats["critical_incidents"] = row[0][0]

        row = await db.execute_fetchall("SELECT COUNT(*) FROM incidents WHERE type = 'pothole'")
        stats["potholes"] = row[0][0]

        row = await db.execute_fetchall(
            "SELECT COUNT(*) FROM incidents WHERE type IN ('road_damage', 'pothole')")
        stats["road_damage"] = row[0][0]

        row = await db.execute_fetchall(
            "SELECT COUNT(*) FROM incidents WHERE type IN ('car', 'bus', 'truck', 'bike')")
        stats["traffic_events"] = row[0][0]

        row = await db.execute_fetchall("SELECT COUNT(*) FROM incidents WHERE type = 'pedestrian'")
        stats["pedestrian_safety"] = row[0][0]

        row = await db.execute_fetchall(
            "SELECT COUNT(*) FROM detections WHERE type IN ('car', 'bus', 'truck', 'bike')")
        stats["vehicles_detected"] = row[0][0]

        return stats
