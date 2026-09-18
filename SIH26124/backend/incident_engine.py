"""
BusSense AI — Incident Engine
Converts detections into incidents with severity, GPS, and timestamps.
Category-Aware:
  * VEHICLE   (car, bike, bus, truck) → tracked for analytics; no auto-incident
  * PEDESTRIAN (pedestrian)           → high-confidence auto-incident
  * ROAD ISSUE (pothole, road_damage) → auto-incident with severity
Spatial deduplication preserved (15m radius) with optional confidence boost.
"""
from datetime import datetime
import database as db
import math

# Severity rules preserved
SEVERITY_RULES = {
    "pothole": lambda conf: "CRITICAL" if conf > 0.85 else "HIGH" if conf > 0.7 else "MEDIUM" if conf > 0.5 else "LOW",
    "pedestrian": lambda conf: "HIGH" if conf > 0.6 else "MEDIUM",
    "car": lambda conf: "LOW",
    "bike": lambda conf: "LOW",
    "bus": lambda conf: "LOW",
    "truck": lambda conf: "MEDIUM" if conf > 0.8 else "LOW",
    "road_damage": lambda conf: "HIGH" if conf > 0.7 else "MEDIUM",
}

CATEGORY_MAP = {
    "pedestrian": "PEDESTRIAN",
    "car": "VEHICLE",
    "bike": "VEHICLE",
    "bus": "VEHICLE",
    "truck": "VEHICLE",
    "pothole": "ROAD ISSUE",
    "road_damage": "ROAD ISSUE",
}

INCIDENT_TYPES = {"pothole", "road_damage"}

MIN_CONFIDENCE = {
    "pothole": 0.45,
    "road_damage": 0.40,
    "pedestrian": 0.50,
}

DESCRIPTIONS = {
    "pothole": "Pothole detected on road surface",
    "pedestrian": "Pedestrian safety concern detected",
    "road_damage": "Road surface damage detected",
    "car": "Vehicle (car) detected in monitoring zone",
    "bike": "Bike/motorcycle detected in monitoring zone",
    "bus": "Bus detected in monitoring zone",
    "truck": "Heavy vehicle (truck) detected in monitoring zone",
}


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


async def process_detection(detection_dict: dict, lat: float = None, lng: float = None,
                              video_id: int = None) -> dict | None:
    det_type = detection_dict["type"]
    confidence = float(detection_dict["confidence"])
    min_conf = MIN_CONFIDENCE.get(det_type, 0.5)
    if confidence < min_conf:
        return None
    severity_fn = SEVERITY_RULES.get(det_type, lambda c: "LOW")
    severity = severity_fn(confidence)
    should_create = det_type in INCIDENT_TYPES or (det_type == "pedestrian" and confidence > 0.6)
    if not should_create:
        return None
    # Use provided lat/lng if available; if not available, do not invent coordinates.
    # The original code uses lat/lng parameters. If they are None, we should not store fake GPS.
    # However, the original logic expects lat/lng. We will pass None only when unavailable,
    # and the create_incident function will store location as None.
    if lat is not None and lng is not None:
        if not (-90 <= float(lat) <= 90 and -180 <= float(lng) <= 180):
            lat = None
            lng = None
    # Spatial deduplication: check recent incidents of same type within 15m
    # Note: if lat/lng are None, skip dedup or treat distance as infinite (don't dedup)
    if video_id is not None and lat is not None and lng is not None:
        try:
            recent_incidents = await db.get_incidents(video_id=video_id, inc_type=det_type, limit=20)
            for inc in recent_incidents:
                inc_loc = inc.get("location")
                if inc_loc and inc_loc.get("lat") is not None and inc_loc.get("lng") is not None:
                    dist = _haversine_distance(lat, lng, inc_loc["lat"], inc_loc["lng"])
                    if dist < 15.0:
                        # Update if confidence is higher
                        if confidence > inc.get("confidence", 0):
                            await db.update_incident(
                                inc["_id"],
                                confidence=confidence,
                                severity=severity,
                                detection_id=detection_dict.get("id"),
                            )
                        return None
        except Exception as e:
            # If MongoDB connection fails, don't crash
            pass
    description = DESCRIPTIONS.get(det_type, f"{det_type} detected")
    # Create incident using MongoDB layer (create_incident handles location validation)
    incident = await db.create_incident(
        inc_type=det_type,
        severity=severity,
        confidence=confidence,
        lat=lat,
        lng=lng,
        video_id=video_id,
        detection_id=detection_dict.get("id"),
        description=description,
    )
    return incident


async def create_manual_incident(inc_type: str, severity: str, lat: float, lng: float,
                                   description: str = None, confidence: float = 1.0) -> dict:
    if not description:
        description = DESCRIPTIONS.get(inc_type, f"Manual {inc_type} report")
    # Validate coordinates; do not invent
    if lat is not None and lng is not None:
        if not (-90 <= float(lat) <= 90 and -180 <= float(lng) <= 180):
            lat = None
            lng = None
    incident = await db.create_incident(
        inc_type=inc_type,
        severity=severity,
        confidence=confidence,
        lat=lat,
        lng=lng,
        description=description,
    )
    return incident