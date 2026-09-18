"""
BusSense AI — Incident Engine
Converts detections into incidents with severity, GPS, and timestamps.

Category-Aware:
  * VEHICLE   (car, bike, bus, truck) → tracked for analytics; no auto-incident
  * PEDESTRIAN (pedestrian)           → high-confidence auto-incident
  * ROAD ISSUE (pothole, road_damage) → auto-incident with severity

Spatial deduplication preserved (15m radius) with optional confidence boost
to prevent duplicate incidents when the same physical hazard is detected
across consecutive video frames.
"""
from datetime import datetime
import database as db
import math

# ── Severity Rules Per Detection Type ──────────────────
SEVERITY_RULES = {
    "pothole": lambda conf: "CRITICAL" if conf > 0.85 else "HIGH" if conf > 0.7 else "MEDIUM" if conf > 0.5 else "LOW",
    "pedestrian": lambda conf: "HIGH" if conf > 0.6 else "MEDIUM",
    "car": lambda conf: "LOW",
    "bike": lambda conf: "LOW",
    "bus": lambda conf: "LOW",
    "truck": lambda conf: "MEDIUM" if conf > 0.8 else "LOW",
    "road_damage": lambda conf: "HIGH" if conf > 0.7 else "MEDIUM",
}

# ── Detection Categories ───────────────────────────────
CATEGORY_MAP = {
    "pedestrian": "PEDESTRIAN",
    "car": "VEHICLE",
    "bike": "VEHICLE",
    "bus": "VEHICLE",
    "truck": "VEHICLE",
    "pothole": "ROAD ISSUE",
    "road_damage": "ROAD ISSUE",
}

# ── Incident Creation Policy ───────────────────────────
# Infrastructure hazards auto-create incidents;
# VEHICLE category is tracked for analytics but does not create incidents
INCIDENT_TYPES = {"pothole", "road_damage"}

# ── Minimum Confidence To Create Incident ─────────────
MIN_CONFIDENCE = {
    "pothole": 0.45,
    "road_damage": 0.40,
    "pedestrian": 0.50,
}

# ── Descriptions ────────────────────────────────────────
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


async def process_detection(detection_dict: dict, lat: float, lng: float,
                              video_id: int = None) -> dict | None:
    """
    Evaluate a detection and optionally create an incident.
    Applies spatial deduplication (15m radius) for detections of the same type
    in the same video so continuous frames don't flood duplicate incidents.
    Returns the incident dict if created, None otherwise.
    """
    det_type = detection_dict["type"]
    confidence = float(detection_dict["confidence"])

    # Minimum confidence check
    min_conf = MIN_CONFIDENCE.get(det_type, 0.5)
    if confidence < min_conf:
        return None

    # Determine severity
    severity_fn = SEVERITY_RULES.get(det_type, lambda c: "LOW")
    severity = severity_fn(confidence)

    # Only infrastructure hazards (pothole, road_damage) and high-confidence
    # pedestrian events create incidents. Vehicles are tracked for analytics.
    should_create = det_type in INCIDENT_TYPES or (det_type == "pedestrian" and confidence > 0.6)

    if not should_create:
        return None

    # ── Spatial Deduplication ──────────────────────────────
    # Prevent hundreds of identical incidents for the same physical hazard.
    # Check for recent incidents of the same type within 15m radius.
    if video_id is not None:
        recent_incidents = await db.get_incidents(video_id=video_id, inc_type=det_type, limit=20)
        for inc in recent_incidents:
            dist = _haversine_distance(lat, lng, inc["lat"], inc["lng"])
            if dist < 15.0:
                # Same physical hazard detected in consecutive frames.
                # If this detection has higher confidence, update the existing incident.
                if confidence > inc.get("confidence", 0):
                    await db.update_incident(
                        inc["id"],
                        confidence=confidence,
                        severity=severity,
                        detection_id=detection_dict.get("id"),
                    )
                return None  # Do not create duplicate incident

    description = DESCRIPTIONS.get(det_type, f"{det_type} detected")

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

    incident = await db.create_incident(
        inc_type=inc_type,
        severity=severity,
        confidence=confidence,
        lat=lat,
        lng=lng,
        description=description,
    )
    return incident
