"""
MongoDB Atlas persistence layer for Smart city intelligence.
Collection: bus_details (and potholes if separate).
"""
import os
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MOTOR = True
except Exception:
    MOTOR = False

from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError, OperationFailure

MONGODB_URI = os.getenv("MONGODB_URI", "")
DB_NAME = "bus_sense"
BUS_COLLECTION = "bus_details"
POTHole_COLLECTION = "potholes"

client = None
db = None


def get_sync_client():
    global client, db
    if client is None:
        if not MONGODB_URI:
            raise ValueError("MONGODB_URI not set")
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
    return client, db


def init_sync():
    get_sync_client()


# ── Validation ──────────────────────────────────────────
def _valid_latlng(lat, lng):
    if lat is None or lng is None:
        return False
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat_f <= 90 and -180 <= lng_f <= 180


def to_leaflet(location: dict):
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


# Sync seed helpers (idempotent, no fake GPS)
def seed_bus_config(number: str, status: str = "inactive"):
    _, db_inst = get_sync_client()
    coll = db_inst[BUS_COLLECTION]
    coll.create_index("bus_number", unique=True)
    existing = coll.find_one({"bus_number": number})
    if existing:
        return existing
    doc = {
        "bus_number": number,
        "route_id": None,
        "route_name": None,
        "direction": None,
        "status": status,
        "location": None,
        "location_source": None,
        "last_updated": datetime.now(timezone.utc),
        "potholes": [],
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    coll.insert_one(doc)
    return coll.find_one({"bus_number": number})


# Async layer for FastAPI
class MongoDBLayer:
    def __init__(self):
        self.use_async = MOTOR and bool(MONGODB_URI)
        try:
            if self.use_async:
                self.client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
                self.db = self.client[DB_NAME]
            else:
                # Fallback: sync connection for simplicity
                _, self.db = get_sync_client()
        except Exception as e:
            print("MongoDB init error:", e)
            self.db = None
        # Indexes
        if self.db:
            try:
                coll = self.db.get_collection(BUS_COLLECTION)
                coll.create_index("bus_number", unique=True)
                pothole_coll = self.db.get_collection(POTHole_COLLECTION)
                pothole_coll.create_index("bus_number")
                pothole_coll.create_index("detected_at")
                pothole_coll.create_index([("location", "2dsphere")], sparse=True)
            except Exception:
                pass

    async def list_buses(self):
        if not self.db:
            return []
        try:
            coll = self.db.get_collection(BUS_COLLECTION)
            if self.use_async:
                docs = await coll.find({}).to_list(length=1000)
                return docs
            else:
                return list(coll.find({}))
        except Exception as e:
            print("list_buses error:", e)
            return []

    async def get_bus(self, bus_number: str):
        if not self.db:
            return None
        try:
            coll = self.db.get_collection(BUS_COLLECTION)
            if self.use_async:
                return await coll.find_one({"bus_number": bus_number})
            else:
                return coll.find_one({"bus_number": bus_number})
        except Exception as e:
            print("get_bus error:", e)
            return None

    async def create_bus(self, bus_number: str, **kwargs):
        if not self.db:
            return None
        try:
            coll = self.db.get_collection(BUS_COLLECTION)
            doc = {
                "bus_number": bus_number,
                "route_id": kwargs.get("route_id"),
                "route_name": kwargs.get("route_name"),
                "direction": kwargs.get("direction"),
                "status": kwargs.get("status", "inactive"),
                "location": None,
                "location_source": kwargs.get("location_source"),
                "last_updated": datetime.now(timezone.utc),
                "potholes": [],
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            # If location provided and valid
            loc = kwargs.get("location")
            if loc and _valid_latlng(loc.get("lat"), loc.get("lng")):
                doc["location"] = {"lat": float(loc["lat"]), "lng": float(loc["lng"])}
            else:
                doc["location"] = None
            if self.use_async:
                await coll.insert_one(doc)
            else:
                coll.insert_one(doc)
            return doc
        except DuplicateKeyError:
            return await self.get_bus(bus_number)
        except Exception as e:
            print("create_bus error:", e)
            return None

    async def update_bus_location(self, bus_number: str, lat: float, lng: float, source: str = "browser"):
        if not self.db:
            return None
        if not _valid_latlng(lat, lng):
            return None
        try:
            coll = self.db.get_collection(BUS_COLLECTION)
            if self.use_async:
                res = await coll.update_one(
                    {"bus_number": bus_number},
                    {"$set": {
                        "location": {"lat": float(lat), "lng": float(lng)},
                        "location_source": source,
                        "last_updated": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }}
                )
            else:
                res = coll.update_one(
                    {"bus_number": bus_number},
                    {"$set": {
                        "location": {"lat": float(lat), "lng": float(lng)},
                        "location_source": source,
                        "last_updated": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }}
                )
            return await self.get_bus(bus_number)
        except Exception as e:
            print("update_bus_location error:", e)
            return None

    async def list_potholes(self, bus_number: Optional[str] = None, limit: int = 100):
        if not self.db:
            return []
        try:
            query = {}
            if bus_number:
                query["bus_number"] = bus_number
            coll = self.db.get_collection(POTHole_COLLECTION)
            if self.use_async:
                cursor = coll.find(query).sort("detected_at", DESCENDING).limit(limit)
                return await cursor.to_list(length=limit)
            else:
                return list(coll.find(query).sort("detected_at", DESCENDING).limit(limit))
        except Exception as e:
            print("list_potholes error:", e)
            return []

    async def create_pothole(self, bus_number: str, severity: str = "MEDIUM", confidence: float = 0.0,
                             lat: Optional[float] = None, lng: Optional[float] = None,
                             source: str = "camera", video_id: Optional[str] = None,
                             description: str = "Pothole detected on road", status: str = "open"):
        if not self.db:
            return None
        loc = None
        if _valid_latlng(lat, lng):
            loc = {"lat": float(lat), "lng": float(lng)}
        doc = {
            "type": "pothole",
            "bus_number": bus_number,
            "severity": severity,
            "confidence": float(confidence) if confidence is not None else None,
            "location": loc,
            "location_source": source,
            "detected_at": datetime.now(timezone.utc),
            "status": status,
            "video_id": video_id,
            "description": description,
            "created_at": datetime.now(timezone.utc),
        }
        try:
            coll = self.db.get_collection(POTHole_COLLECTION)
            if self.use_async:
                result = await coll.insert_one(doc)
                doc["_id"] = result.inserted_id
            else:
                result = coll.insert_one(doc)
                doc["_id"] = result.inserted_id
            return doc
        except Exception as e:
            print("create_pothole error:", e)
            return None

    async def get_pothole(self, pothole_id: str) -> Optional[Dict]:
        if not self.db:
            return None
        try:
            from bson.objectid import ObjectId
            coll = self.db.get_collection(POTHole_COLLECTION)
            if self.use_async:
                return await coll.find_one({"_id": ObjectId(pothole_id)})
            else:
                return coll.find_one({"_id": ObjectId(pothole_id)})
        except Exception as e:
            print("get_pothole error:", e)
            return None

    async def update_pothole(self, pothole_id: str, **kwargs):
        if not self.db:
            return None
        try:
            from bson.objectid import ObjectId
            updates = {k: v for k, v in kwargs.items() if v is not None}
            if "location" in updates:
                loc = updates["location"]
                if loc and not _valid_latlng(loc.get("lat"), loc.get("lng")):
                    updates["location"] = None
                elif loc is None:
                # keep as is; user may explicitly set null
                    pass
            coll = self.db.get_collection(POTHole_COLLECTION)
            if self.use_async:
                await coll.update_one({"_id": ObjectId(pothole_id)}, {"$set": updates})
                return await self.get_pothole(pothole_id)
            else:
                coll.update_one({"_id": ObjectId(pothole_id)}, {"$set": updates})
                return self.get_pothole(pothole_id)
        except Exception as e:
            print("update_pothole error:", e)
            return None
