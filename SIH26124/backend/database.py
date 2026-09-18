"""
RoadGuard AI — MongoDB Database Layer
Collections: bus_details, incidents
Plus SQLite for videos and detections (to minimize changes).
"""
import os
import json
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import aiosqlite  # for videos and detections
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError
from bson.objectid import ObjectId

# ── MongoDB Setup ────────────────────────────────────────────────────────
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb+srv://Rohan:Rohan8074@cluster0.un5hzzk.mongodb.net/?appName=Cluster0")
DB_NAME = "bus_sense"
BUS_COLLECTION = "bus_details"
INCIDENT_COLLECTION = "incidents"

# Global MongoDB client and database
mongo_client: Optional[AsyncIOMotorClient] = None
mongo_db = None


async def connect_to_mongo():
    global mongo_client, mongo_db
    if not MONGODB_URI:
        raise ValueError("MONGODB_URI environment variable is not set")
    mongo_client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    mongo_db = mongo_client[DB_NAME]
    # Create indexes
    await mongo_db[BUS_COLLECTION].create_index("bus_number", unique=True)
    await mongo_db[INCIDENT_COLLECTION].create_index([("bus_number", ASCENDING)])
    await mongo_db[INCIDENT_COLLECTION].create_index([("detected_at", DESCENDING)])
    await mongo_db[INCIDENT_COLLECTION].create_index([("status", ASCENDING)])
    await mongo_db[INCIDENT_COLLECTION].create_index([("type", ASCENDING)])
    # Optional: 2dsphere index for location if we store as GeoJSON
    # We are storing as {lat: ..., lng: ...} so we cannot use 2dsphere directly.
    # If we want to use GeoJSON queries, we would need to store as GeoJSON and then index.
    # We are not doing GeoJSON queries in the application, so we skip.


async def close_mongo_connection():
    global mongo_client
    if mongo_client:
        mongo_client.close()


# ── SQLite Setup (for videos and detections) ─────────────────────────────
SQLITE_DB_PATH = os.path.join(os.path.dirname(__file__), "roadguard.db")


async def get_sqlite_db():
    db = await aiosqlite.connect(SQLITE_DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


# ── Validation ───────────────────────────────────────────────────────────
def _valid_latlng(lat, lng):
    if lat is None or lng is None:
        return False
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat_f <= 90 and -180 <= lng_f <= 180


def _to_leaflet(location: dict):
    if not location:
        return None
    lat = location.get("lat")
    lng = location.get("lng")
    if lat is None or lng is None:
        return None
    try:
        lat_f = float(lat)
        lng_f = float(lng)
        if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
            return None
        return [lat_f, lng_f]
    except Exception:
        return None


# ── Bus Functions (MongoDB) ───────────────────────────────────────────────
async def get_buses():
    if mongo_db is None:
        await connect_to_mongo()
    try:
        cursor = mongo_db[BUS_COLLECTION].find({})
        buses = await cursor.to_list(length=1000)
        # Convert ObjectId to string for JSON serialization? We'll keep it as is and let the encoder handle?
        # But we are returning dicts that may have ObjectId. We'll convert to string for safety.
        for bus in buses:
            bus["_id"] = str(bus["_id"])
        return buses
    except Exception as e:
        print(f"Error getting buses: {e}")
        return []


async def get_bus_by_number(bus_number: str):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        bus = await mongo_db[BUS_COLLECTION].find_one({"bus_number": bus_number})
        if bus:
            bus["_id"] = str(bus["_id"])
        return bus
    except Exception as e:
        print(f"Error getting bus by number {bus_number}: {e}")
        return None


async def create_bus(bus_number: str, **kwargs):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        # Check if bus already exists
        existing = await mongo_db[BUS_COLLECTION].find_one({"bus_number": bus_number})
        if existing:
            existing["_id"] = str(existing["_id"])
            return existing
        # Prepare bus document
        bus_doc = {
            "bus_number": bus_number,
            "route_id": kwargs.get("route_id"),
            "route_name": kwargs.get("route_name"),
            "direction": kwargs.get("direction"),
            "status": kwargs.get("status", "inactive"),
            "location": None,  # {lat: ..., lng: ...} or None
            "location_source": kwargs.get("location_source"),
            "last_updated": datetime.now(timezone.utc),
            "potholes": [],  # We are not storing pothole IDs in the bus document
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        loc = kwargs.get("location")
        if loc and _valid_latlng(loc.get("lat"), loc.get("lng")):
            bus_doc["location"] = {"lat": float(loc["lat"]), "lng": float(loc["lng"])}
        result = await mongo_db[BUS_COLLECTION].insert_one(bus_doc)
        bus_doc["_id"] = str(result.inserted_id)
        return bus_doc
    except DuplicateKeyError:
        # Should not happen because we checked, but just in case
        return await get_bus_by_number(bus_number)
    except Exception as e:
        print(f"Error creating bus {bus_number}: {e}")
        return None


async def update_bus_location(bus_number: str, latitude: float, longitude: float, source: str = "browser"):
    if mongo_db is None:
        await connect_to_mongo()
    if not _valid_latlng(latitude, longitude):
        return None
    try:
        result = await mongo_db[BUS_COLLECTION].update_one(
            {"bus_number": bus_number},
            {"$set": {
                "location": {"lat": float(latitude), "lng": float(longitude)},
                "location_source": source,
                "last_updated": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }}
        )
        if result.matched_count == 0:
            return None
        return await get_bus_by_number(bus_number)
    except Exception as e:
        print(f"Error updating bus location for {bus_number}: {e}")
        return None


# ── Incident Functions (MongoDB) ───────────────────────────────────────────
async def create_incident(inc_type: str, severity: str, confidence: float, lat: Optional[float], lng: Optional[float],
                          video_id: Optional[int] = None, detection_id: Optional[int] = None, description: Optional[str] = None,
                          timestamp: Optional[datetime] = None):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        # Validate coordinates if provided
        location = None
        if lat is not None and lng is not None:
            if _valid_latlng(lat, lng):
                location = {"lat": float(lat), "lng": float(lng)}
            # else leave as None
        incident_doc = {
            "type": inc_type,
            "severity": severity,
            "confidence": float(confidence) if confidence is not None else None,
            "location": location,
            "location_source": "camera",  # default, can be overridden by kwargs? We don't have source param here.
            "video_id": video_id,
            "detection_id": detection_id,
            "description": description,
            "detected_at": timestamp or datetime.now(timezone.utc),
            "status": "open",
            "created_at": datetime.now(timezone.utc),
        }
        # Remove None values to keep documents clean? We'll keep them for clarity.
        result = await mongo_db[INCIDENT_COLLECTION].insert_one(incident_doc)
        incident_doc["_id"] = str(result.inserted_id)
        return incident_doc
    except Exception as e:
        print(f"Error creating incident: {e}")
        return None


async def get_incident(incident_id: str):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        incident = await mongo_db[INCIDENT_COLLECTION].find_one({"_id": ObjectId(incident_id)})
        if incident:
            incident["_id"] = str(incident["_id"])
        return incident
    except Exception as e:
        print(f"Error getting incident {incident_id}: {e}")
        return None


async def get_incidents(status: Optional[str] = None, inc_type: Optional[str] = None, severity: Optional[str] = None,
                        video_id: Optional[int] = None, limit: int = 100):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        query = {}
        if status:
            query["status"] = status
        if inc_type:
            query["type"] = inc_type
        if severity:
            query["severity"] = severity
        if video_id is not None:
            query["video_id"] = video_id
        cursor = mongo_db[INCIDENT_COLLECTION].find(query).sort("detected_at", DESCENDING).limit(limit)
        incidents = await cursor.to_list(length=limit)
        for incident in incidents:
            incident["_id"] = str(incident["_id"])
        return incidents
    except Exception as e:
        print(f"Error getting incidents: {e}")
        return []


async def update_incident(incident_id: str, **kwargs):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        # Remove None values and ignore fields that shouldn't be updated
        updates = {k: v for k, v in kwargs.items() if v is not None}
        # Validate location if present
        if "location" in updates:
            loc = updates["location"]
            if loc and not _valid_latlng(loc.get("lat"), loc.get("lng")):
                updates["location"] = None
        # Always update the updated_at timestamp
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await mongo_db[INCIDENT_COLLECTION].update_one(
            {"_id": ObjectId(incident_id)},
            {"$set": updates}
        )
        if result.matched_count == 0:
            return None
        return await get_incident(incident_id)
    except Exception as e:
        print(f"Error updating incident {incident_id}: {e}")
        return None


async def delete_incident(incident_id: str):
    if mongo_db is None:
        await connect_to_mongo()
    try:
        result = await mongo_db[INCIDENT_COLLECTION].delete_one({"_id": ObjectId(incident_id)})
        return result.deleted_count > 0
    except Exception as e:
        print(f"Error deleting incident {incident_id}: {e}")
        return False


# ── Stats Function (Mix of MongoDB and SQLite) ─────────────────────────────
async def get_stats():
    stats = {}
    # Incidents from MongoDB
    if mongo_db is not None:
        try:
            # Total incidents
            stats["total_incidents"] = await mongo_db[INCIDENT_COLLECTION].count_documents({})
            # Open incidents
            stats["open_incidents"] = await mongo_db[INCIDENT_COLLECTION].count_documents({"status": "open"})
            # Critical incidents
            stats["critical_incidents"] = await mongo_db[INCIDENT_COLLECTION].count_documents({"severity": "CRITICAL"})
            # Potholes
            stats["potholes"] = await mongo_db[INCIDENT_COLLECTION].count_documents({"type": "pothole"})
            # Road damage (including pothole)
            stats["road_damage"] = await mongo_db[INCIDENT_COLLECTION].count_documents(
                {"type": {"$in": ["road_damage", "pothole"]}}
            )
            # Traffic events (car, bus, truck, bike)
            stats["traffic_events"] = await mongo_db[INCIDENT_COLLECTION].count_documents(
                {"type": {"$in": ["car", "bus", "truck", "bike"]}}
            )
            # Pedestrian safety
            stats["pedestrian_safety"] = await mongo_db[INCIDENT_COLLECTION].count_documents({"type": "pedestrian"})
        except Exception as e:
            print(f"Error getting incident stats from MongoDB: {e}")
            # Set to 0 on error
            stats.setdefault("total_incidents", 0)
            stats.setdefault("open_incidents", 0)
            stats.setdefault("critical_incidents", 0)
            stats.setdefault("potholes", 0)
            stats.setdefault("road_damage", 0)
            stats.setdefault("traffic_events", 0)
            stats.setdefault("pedestrian_safety", 0)
    else:
        # If MongoDB not connected, set incident stats to 0
        stats.setdefault("total_incidents", 0)
        stats.setdefault("open_incidents", 0)
        stats.setdefault("critical_incidents", 0)
        stats.setdefault("potholes", 0)
        stats.setdefault("road_damage", 0)
        stats.setdefault("traffic_events", 0)
        stats.setdefault("pedestrian_safety", 0)

    # Vehicles detected from SQLite detections table
    try:
        sqlite_db = await get_sqlite_db()
        cursor = await sqlite_db.execute(
            """SELECT COUNT(*) FROM detections
               WHERE type IN ('car', 'bus', 'truck', 'bike')"""
        )
        row = await cursor.fetchone()
        stats["vehicles_detected"] = row[0] if row else 0
        await sqlite_db.close()
    except Exception as e:
        print(f"Error getting vehicle detections from SQLite: {e}")
        stats["vehicles_detected"] = 0

    return stats


# ── Update Bus (MongoDB) ──────────────────────────────────────────────────
async def update_bus(bus_number: str, **kwargs):
    if mongo_db is None:
        await connect_to_mongo()
    updates = {k: v for k, v in kwargs.items() if v is not None}
    # Handle location validation
    if "location" in updates:
        loc = updates["location"]
        if loc and not _valid_latlng(loc.get("lat"), loc.get("lng")):
            updates["location"] = None
    # Only allow specific fields to be updated
    allowed = {"status", "route_id", "route_name", "direction", "location", "location_source", "last_updated", "updated_at"}
    updates = {k: v for k, v in updates.items() if k in allowed}
    if not updates:
        return await get_bus_by_number(bus_number)
    updates["updated_at"] = datetime.now(timezone.utc)
    try:
        result = await mongo_db[BUS_COLLECTION].update_one(
            {"bus_number": bus_number},
            {"$set": updates}
        )
        return await get_bus_by_number(bus_number)
    except Exception as e:
        print(f"Error updating bus {bus_number}: {e}")
        return None


# ── Routes (SQLite or MongoDB - we will leave in SQLite for simplicity) ───
# Actually, routes are not required by the user for MongoDB. We can skip them for now.
# But the main.py references get_routes and get_route_by_bus_number.
# We need to implement them. Let's use a simple in-memory approach or SQLite.
# Since SQLite is available, let's create routes table if it doesn't exist in the SQLite DB.

# Actually, the routes table is already created in the original database.py schema.
# But we removed the schema creation for routes in init_db. Let's add it back for SQLite.

# Wait, we already have the videos/detections creation in init_db. We need routes too.
# Let's add routes creation to init_db.

# ── Routes (SQLite) ────────────────────────────────────────────────────────
# We will add the routes table creation in init_db. For now, I'll rely on the original SQLite DB file (roadguard.db) which already has it.
# But if we are using a new DB file, it might not exist. Let's add it in init_db.

# Let's edit init_db to include routes creation.
# We leave these unchanged from the original database.py, but we must adapt them to use the SQLite connection.

async def create_video(filename, original_name, gps_lat=None, gps_lng=None,
                       gps_end_lat=None, gps_end_lng=None):
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
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
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        await db.execute(f"UPDATE videos SET {sets} WHERE id = ?", vals)
        await db.commit()
    return await get_video(video_id)


async def get_video(video_id):
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM videos WHERE id = ?", (video_id,))
        return dict(rows[0]) if rows else None


async def get_videos(limit=50):
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM videos ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]


async def create_detection(video_id, det_type, confidence, frame_number,
                           bbox_x=0, bbox_y=0, bbox_w=0, bbox_h=0, lat=None, lng=None):
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
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
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if video_id:
            rows = await db.execute_fetchall(
                "SELECT * FROM detections WHERE video_id = ? ORDER BY id DESC LIMIT ?",
                (video_id, limit))
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM detections ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]


# ── Routes (SQLite) ────────────────────────────────────────────────────────
async def get_routes():
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM routes ORDER BY bus_number")
        return [dict(r) for r in rows]


async def get_route_by_bus_number(bus_number: str):
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            "SELECT * FROM routes WHERE bus_number = ?", (bus_number,)
        )
        return dict(rows[0]) if rows else None


# ── Initialization and Seeding ─────────────────────────────────────────────
async def init_db():
    # Initialize MongoDB connection
    await connect_to_mongo()
    # Initialize SQLite: ensure videos, detections, and routes tables exist
    async with aiosqlite.connect(SQLITE_DB_PATH) as db:
        # We don't need to create the buses, incidents tables because we are using MongoDB.
        # But we must ensure the videos, detections, and routes tables exist.
        await db.execute("""
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
                gps_end_lng REAL,
                annotated_filename TEXT
            );
        """)
        await db.execute("""
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
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bus_number TEXT NOT NULL,
                route_name TEXT,
                direction TEXT,
                start_point TEXT,
                end_point TEXT,
                stops TEXT,
                route_coordinates TEXT
            );
        """)
        await db.commit()

    # Seed the bus configuration if not already present
    await seed_bus_routes()


async def seed_bus_routes():
    """Seed the prototype transit configuration once.

    Route coordinates are intentionally left empty until verified route geometry
    is available. Bus numbers and endpoint metadata are not live GPS data.
    """
    if mongo_db is None:
        await connect_to_mongo()
    buses = [
        ("72/277D", "live"),
        ("277", "live"),
        ("1Z", "live"),
    ]

    for bus_number, status in buses:
        existing = await mongo_db[BUS_COLLECTION].find_one({"bus_number": bus_number})
        if not existing:
            await create_bus(bus_number, status=status)

    # Note: We are not seeding routes in MongoDB because the user did not require it.
    # The existing routes table in SQLite is not used anymore. We can ignore it.


# ── Cleanup ───────────────────────────────────────────────────────────────
async def close_db_connections():
    await close_mongo_connection()
    # SQLite connections are closed per use.