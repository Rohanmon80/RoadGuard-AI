"""
RoadGuard AI — FastAPI Backend
REST API + WebSocket for real-time updates.
"""

import os
import uuid
import json
import asyncio
import logging

from datetime import datetime
from contextlib import asynccontextmanager

import cv2
import numpy as np

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Response,
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel
from typing import Optional

import database as db
from ai_engine import AIDetectionEngine
from video_processor import VideoProcessor, UPLOAD_DIR


# =========================================================
# LOGGING
# =========================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# =========================================================
# DIRECTORIES
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PROCESSED_DIR = os.path.join(
    BASE_DIR,
    "processed_videos"
)

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)


# =========================================================
# GLOBALS
# =========================================================

ai_engine: Optional[AIDetectionEngine] = None
video_processor: Optional[VideoProcessor] = None

ws_connections: set[WebSocket] = set()


# =========================================================
# JSON SERIALIZER
# =========================================================

def datetime_serializer(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()

    raise TypeError(
        f"Type {type(obj)} not serializable"
    )


# =========================================================
# LIFESPAN
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global ai_engine
    global video_processor

    await db.init_db()

    ai_engine = AIDetectionEngine()

    video_processor = VideoProcessor(
        ai_engine
    )

    logger.info(
        "RoadGuard AI backend started"
    )

    yield

    logger.info(
        "RoadGuard AI backend stopped"
    )


# =========================================================
# FASTAPI APP
# =========================================================

app = FastAPI(
    title="RoadGuard AI",
    version="1.0.0",
    lifespan=lifespan,
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# STATIC FILES
# =========================================================

# Original uploaded videos
app.mount(
    "/uploads",
    StaticFiles(
        directory=UPLOAD_DIR
    ),
    name="uploads",
)


# AI processed / annotated videos
app.mount(
    "/processed-videos",
    StaticFiles(
        directory=PROCESSED_DIR
    ),
    name="processed-videos",
)


# =========================================================
# PYDANTIC MODELS
# =========================================================

class IncidentCreate(BaseModel):
    type: str
    severity: str = "MEDIUM"
    lat: float
    lng: float
    confidence: float = 1.0
    description: Optional[str] = None


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None


class BusCreate(BaseModel):
    bus_number: str
    status: Optional[str] = None
    route_id: Optional[int] = None
    route_name: Optional[str] = None
    direction: Optional[str] = None


class BusUpdate(BaseModel):
    status: Optional[str] = None
    route_id: Optional[int] = None
    route_name: Optional[str] = None
    direction: Optional[str] = None


class PotholeCreate(BaseModel):
    severity: str = "MEDIUM"
    confidence: float = 0.0
    lat: Optional[float] = None
    lng: Optional[float] = None
    source: str = "camera"
    video_id: Optional[str] = None
    description: str = "Pothole detected on road"
    status: str = "open"


class PotholeUpdate(BaseModel):
    severity: Optional[str] = None
    confidence: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    source: Optional[str] = None
    video_id: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


# =========================================================
# WEBSOCKET BROADCAST
# =========================================================

async def broadcast(
    event_type: str,
    data: dict
):
    """
    Send event to all connected WebSocket clients.
    """

    global ws_connections

    message = json.dumps(
        {
            "event": event_type,
            "data": data,
        },
        default=datetime_serializer,
    )

    dead = set()

    for ws in ws_connections:
        try:
            await ws.send_text(message)

        except Exception:
            dead.add(ws)

    ws_connections -= dead


# =========================================================
# WEBSOCKET
# =========================================================

@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket
):
    await ws.accept()

    ws_connections.add(ws)

    logger.info(
        f"WebSocket connected "
        f"({len(ws_connections)} total)"
    )

    try:
        while True:
            await ws.receive_text()

    except WebSocketDisconnect:
        ws_connections.discard(ws)

        logger.info(
            f"WebSocket disconnected "
            f"({len(ws_connections)} total)"
        )

    except Exception:
        ws_connections.discard(ws)


# =========================================================
# STATS
# =========================================================

@app.get("/api/stats")
async def get_stats():
    return await db.get_stats()


# =========================================================
# LIVE AI CAMERA DETECTION
# =========================================================

@app.post("/api/live/detect")
async def live_detect(
    frame: UploadFile = File(...)
):
    """
    Process one live camera frame.

    Flow:

        Browser camera
              ↓
        JPEG frame
              ↓
        OpenCV
              ↓
        YOLO AI Engine
              ↓
        Bounding boxes
              ↓
        Class + confidence
              ↓
        Annotated JPEG
              ↓
        Browser

    IMPORTANT:
    No detection is stored in MongoDB.
    """

    global ai_engine

    if ai_engine is None:
        raise HTTPException(
            status_code=503,
            detail="AI engine is not initialized",
        )

    try:
        # -----------------------------------------------------
        # Read uploaded camera frame
        # -----------------------------------------------------

        image_bytes = await frame.read()

        if not image_bytes:
            raise HTTPException(
                status_code=400,
                detail="Empty camera frame",
            )

        # -----------------------------------------------------
        # Convert JPEG bytes → NumPy array
        # -----------------------------------------------------

        np_buffer = np.frombuffer(
            image_bytes,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            np_buffer,
            cv2.IMREAD_COLOR,
        )

        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid image frame",
            )

        # -----------------------------------------------------
        # Run AI detection.
        #
        # Use a worker thread so the synchronous YOLO
        # inference doesn't block FastAPI's event loop.
        # -----------------------------------------------------

        detections, annotated_frame = await asyncio.to_thread(
            ai_engine.detect_and_annotate,
            image,
            0,
            True,
            True,
            True,
            True,
        )

        # -----------------------------------------------------
        # Encode annotated image → JPEG
        # -----------------------------------------------------

        success, encoded = cv2.imencode(
            ".jpg",
            annotated_frame,
            [
                cv2.IMWRITE_JPEG_QUALITY,
                85,
            ],
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to encode annotated frame",
            )

        # -----------------------------------------------------
        # Count classes in this frame
        # -----------------------------------------------------

        counts = {
            "pothole": 0,
            "car": 0,
            "bus": 0,
            "bike": 0,
            "truck": 0,
            "pedestrian": 0,
        }

        detection_list = []

        for detection in detections:
            detection_type = str(
                getattr(
                    detection,
                    "type",
                    "",
                )
            ).lower()

            confidence = float(
                getattr(
                    detection,
                    "confidence",
                    0.0,
                )
            )

            bbox = getattr(
                detection,
                "bbox",
                None,
            )

            # Normalize possible aliases.
            if detection_type in (
                "person",
                "pedestrian",
            ):
                count_key = "pedestrian"

            elif detection_type in (
                "car",
                "automobile",
            ):
                count_key = "car"

            elif detection_type in (
                "bus",
            ):
                count_key = "bus"

            elif detection_type in (
                "bike",
                "bicycle",
                "motorcycle",
            ):
                count_key = "bike"

            elif detection_type in (
                "truck",
            ):
                count_key = "truck"

            elif detection_type in (
                "pothole",
                "road_damage",
            ):
                count_key = "pothole"

            else:
                count_key = detection_type

            if count_key in counts:
                counts[count_key] += 1

            detection_list.append(
                {
                    "type": detection_type,
                    "confidence": confidence,
                    "bbox": bbox,
                }
            )

        # -----------------------------------------------------
        # Send annotated image.
        #
        # Detection information is included in headers so the
        # frontend can optionally update live counters without
        # creating database records.
        # -----------------------------------------------------

        headers = {
            "Cache-Control": "no-store",
            "X-Detection-Counts": json.dumps(
                counts
            ),
            "X-Detection-Total": str(
                len(detections)
            ),
        }

        return Response(
            content=encoded.tobytes(),
            media_type="image/jpeg",
            headers=headers,
        )

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Live AI detection failed"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Live detection failed: {exc}",
        )


# =========================================================
# LIVE AI DETECTION JSON
# =========================================================

@app.post("/api/live/detect/json")
async def live_detect_json(
    frame: UploadFile = File(...)
):
    """
    Optional JSON version of live detection.

    Returns detection metadata and an annotated image
    encoded as base64.

    The normal frontend display should use /api/live/detect.
    """

    global ai_engine

    if ai_engine is None:
        raise HTTPException(
            status_code=503,
            detail="AI engine is not initialized",
        )

    try:
        import base64

        image_bytes = await frame.read()

        if not image_bytes:
            raise HTTPException(
                status_code=400,
                detail="Empty camera frame",
            )

        np_buffer = np.frombuffer(
            image_bytes,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            np_buffer,
            cv2.IMREAD_COLOR,
        )

        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid image frame",
            )

        detections, annotated_frame = await asyncio.to_thread(
            ai_engine.detect_and_annotate,
            image,
            0,
            True,
            True,
            True,
            True,
        )

        success, encoded = cv2.imencode(
            ".jpg",
            annotated_frame,
            [
                cv2.IMWRITE_JPEG_QUALITY,
                85,
            ],
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to encode frame",
            )

        counts = {
            "pothole": 0,
            "car": 0,
            "bus": 0,
            "bike": 0,
            "truck": 0,
            "pedestrian": 0,
        }

        detection_list = []

        for detection in detections:
            detection_type = str(
                getattr(
                    detection,
                    "type",
                    "",
                )
            ).lower()

            confidence = float(
                getattr(
                    detection,
                    "confidence",
                    0.0,
                )
            )

            bbox = getattr(
                detection,
                "bbox",
                None,
            )

            if detection_type in (
                "person",
                "pedestrian",
            ):
                count_key = "pedestrian"

            elif detection_type in (
                "car",
                "automobile",
            ):
                count_key = "car"

            elif detection_type == "bus":
                count_key = "bus"

            elif detection_type in (
                "bike",
                "bicycle",
                "motorcycle",
            ):
                count_key = "bike"

            elif detection_type == "truck":
                count_key = "truck"

            elif detection_type in (
                "pothole",
                "road_damage",
            ):
                count_key = "pothole"

            else:
                count_key = detection_type

            if count_key in counts:
                counts[count_key] += 1

            detection_list.append(
                {
                    "type": detection_type,
                    "confidence": confidence,
                    "bbox": bbox,
                }
            )

        encoded_base64 = base64.b64encode(
            encoded.tobytes()
        ).decode("utf-8")

        return {
            "success": True,
            "image": (
                "data:image/jpeg;base64,"
                + encoded_base64
            ),
            "detections": detection_list,
            "counts": counts,
            "total": len(detections),
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Live JSON detection failed"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                f"Live JSON detection failed: {exc}"
            ),
        )


# =========================================================
# VIDEO UPLOAD
# =========================================================

@app.post("/api/videos/upload")
async def upload_video(
    file: UploadFile = File(...),

    gps_lat: Optional[float] = Form(None),
    gps_lng: Optional[float] = Form(None),

    gps_end_lat: Optional[float] = Form(None),
    gps_end_lng: Optional[float] = Form(None),
):
    """
    Upload a video.

    The uploaded video is stored in /uploads and metadata
    is saved to the database.
    """

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No filename supplied",
        )

    ext = (
        os.path.splitext(
            file.filename
        )[1]
        or ".mp4"
    )

    filename = (
        f"{uuid.uuid4().hex}{ext}"
    )

    filepath = os.path.join(
        UPLOAD_DIR,
        filename,
    )

    try:
        with open(
            filepath,
            "wb"
        ) as f:
            content = await file.read()
            f.write(content)

    except Exception as exc:
        logger.exception(
            "Failed to save uploaded video"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to save video: {exc}"
            ),
        )

    video = await db.create_video(
        filename=filename,
        original_name=file.filename,

        gps_lat=gps_lat,
        gps_lng=gps_lng,

        gps_end_lat=gps_end_lat,
        gps_end_lng=gps_end_lng,
    )

    return video


# =========================================================
# START VIDEO PROCESSING
# =========================================================

@app.post(
    "/api/videos/{video_id}/process"
)
async def start_processing(
    video_id: int
):
    """
    Start AI processing in the background.

    Individual frame detections are NOT stored in MongoDB.
    The annotated video is written to processed_videos.
    """

    if video_processor is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Video processor is not initialized"
            ),
        )

    video = await db.get_video(
        video_id
    )

    if not video:
        raise HTTPException(
            status_code=404,
            detail="Video not found",
        )

    if video.get("status") == "processing":
        raise HTTPException(
            status_code=400,
            detail="Already processing",
        )

    async def notify(
        event_type,
        data
    ):
        await broadcast(
            event_type,
            data
        )

    asyncio.create_task(
        video_processor.process_video(
            video_id,
            notify,
        )
    )

    return {
        "status": "started",
        "video_id": video_id,
    }


# =========================================================
# VIDEO STATUS
# =========================================================

@app.get(
    "/api/videos/{video_id}/status"
)
async def video_status(
    video_id: int
):
    """
    Return database video metadata + current processing job.
    """

    if video_processor is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Video processor is not initialized"
            ),
        )

    video = await db.get_video(
        video_id
    )

    if not video:
        raise HTTPException(
            status_code=404,
            detail="Video not found",
        )

    job = video_processor.get_job_status(
        video_id
    )

    response = {
        **video,
        "job": job,
    }

    if isinstance(job, dict):
        output_filename = job.get(
            "output_filename"
        )

        if output_filename:
            response["output_url"] = (
                "/processed-videos/"
                + output_filename
            )

        elif job.get("output_url"):
            response["output_url"] = (
                job["output_url"]
            )

    return response


# =========================================================
# VIDEO RESULT
# =========================================================

@app.get(
    "/api/videos/{video_id}/result"
)
async def video_result(
    video_id: int
):
    """
    Return final AI processing result.
    """

    if video_processor is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Video processor is not initialized"
            ),
        )

    video = await db.get_video(
        video_id
    )

    if not video:
        raise HTTPException(
            status_code=404,
            detail="Video not found",
        )

    job = video_processor.get_job_status(
        video_id
    )

    if not job:
        return {
            "video_id": video_id,
            "status": video.get(
                "status"
            ),
            "output_url": None,
            "counts": {},
            "total_detections": 0,
        }

    output_url = None

    if job.get("output_filename"):
        output_url = (
            "/processed-videos/"
            + job["output_filename"]
        )

    elif job.get("output_url"):
        output_url = job[
            "output_url"
        ]

    return {
        "video_id": video_id,

        "status": job.get(
            "status",
            video.get("status"),
        ),

        "output_url": output_url,

        "output_filename": job.get(
            "output_filename"
        ),

        "counts": job.get(
            "counts",
            {},
        ),

        "total_detections": job.get(
            "detections_count",
            job.get(
                "total_detections",
                0
            ),
        ),

        "processed_frames": job.get(
            "processed_frames",
            0,
        ),

        "total_frames": job.get(
            "total_frames",
            0,
        ),
    }


# =========================================================
# HEALTH
# =========================================================

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "app": "RoadGuard AI",
    }


# =========================================================
# VIDEOS
# =========================================================

@app.get("/api/videos")
async def list_videos(
    limit: int = 50
):
    return await db.get_videos(
        limit=limit
    )


# =========================================================
# INCIDENTS
# =========================================================

@app.get("/api/incidents")
async def list_incidents(
    status: Optional[str] = None,
    type: Optional[str] = None,
    severity: Optional[str] = None,
    video_id: Optional[int] = None,
    limit: int = 100,
):
    return await db.get_incidents(
        status=status,
        inc_type=type,
        severity=severity,
        video_id=video_id,
        limit=limit,
    )


@app.post("/api/incidents")
async def create_incident(
    body: IncidentCreate
):
    from incident_engine import (
        create_manual_incident
    )

    incident = (
        await create_manual_incident(
            inc_type=body.type,
            severity=body.severity,
            lat=body.lat,
            lng=body.lng,
            description=body.description,
            confidence=body.confidence,
        )
    )

    await broadcast(
        "new_incident",
        incident,
    )

    stats = await db.get_stats()

    await broadcast(
        "stats_update",
        stats,
    )

    return incident


@app.patch(
    "/api/incidents/{incident_id}"
)
async def update_incident(
    incident_id: int,
    body: IncidentUpdate,
):
    updates = {
        k: v
        for k, v in body.model_dump().items()
        if v is not None
    }

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No fields to update",
        )

    incident = await db.update_incident(
        incident_id,
        **updates,
    )

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    await broadcast(
        "incident_updated",
        incident,
    )

    stats = await db.get_stats()

    await broadcast(
        "stats_update",
        stats,
    )

    return incident


@app.get(
    "/api/incidents/{incident_id}"
)
async def get_incident(
    incident_id: int
):
    incident = await db.get_incident(
        incident_id
    )

    if not incident:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return incident


@app.delete(
    "/api/incidents/{incident_id}"
)
async def delete_incident(
    incident_id: int
):
    existing = await db.get_incident(
        incident_id
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    await db.delete_incident(
        incident_id
    )

    await broadcast(
        "incident_deleted",
        {
            "id": incident_id
        },
    )

    stats = await db.get_stats()

    await broadcast(
        "stats_update",
        stats,
    )

    return {
        "status": "deleted",
        "id": incident_id,
    }


# =========================================================
# DETECTIONS — LEGACY
# =========================================================

@app.get("/api/detections")
async def list_detections(
    video_id: Optional[int] = None,
    limit: int = 100,
):
    """
    Legacy endpoint.

    The current video processor does NOT create individual
    detection records.

    Kept only for compatibility with older components.
    """

    return await db.get_detections(
        video_id=video_id,
        limit=limit,
    )


# =========================================================
# AI ENGINE INFO
# =========================================================

@app.get("/api/ai/info")
async def ai_info():

    if ai_engine is None:
        raise HTTPException(
            status_code=503,
            detail="AI engine is not initialized",
        )

    return ai_engine.get_engine_info()


@app.get("/api/ai/categories")
async def ai_categories():
    return {
        "categories": [
            "VEHICLE",
            "PEDESTRIAN",
            "ROAD ISSUE",
        ],

        "supported_classes": (
            SUPPORTED_DETECTION_CLASSES
            if "SUPPORTED_DETECTION_CLASSES"
            in globals()
            else []
        ),
    }


# =========================================================
# BUSES
# =========================================================

@app.get("/api/buses")
async def api_get_buses():
    return await db.get_buses()


@app.get(
    "/api/buses/{bus_number}"
)
async def api_get_bus(
    bus_number: str
):
    bus = await db.get_bus_by_number(
        bus_number
    )

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found",
        )

    return bus


@app.post("/api/buses")
async def api_create_bus(
    bus: BusCreate
):
    existing = (
        await db.get_bus_by_number(
            bus.bus_number
        )
    )

    if existing:
        return existing

    created = await db.create_bus(
        bus_number=bus.bus_number,
        status=bus.status,
        route_id=bus.route_id,
        route_name=bus.route_name,
        direction=bus.direction,
    )

    if not created:
        raise HTTPException(
            status_code=400,
            detail="Failed to create bus",
        )

    return created


@app.patch(
    "/api/buses/{bus_number}"
)
async def api_update_bus(
    bus_number: str,
    bus: BusUpdate,
):
    updates = {
        k: v
        for k, v in bus.model_dump().items()
        if v is not None
    }

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No fields to update",
        )

    updated_bus = await db.update_bus(
        bus_number,
        **updates,
    )

    if not updated_bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found",
        )

    return updated_bus


# =========================================================
# BUS LOCATION
# =========================================================

@app.post(
    "/api/buses/{bus_number}/location"
)
async def api_update_bus_location(
    bus_number: str,
    latitude: float = Form(...),
    longitude: float = Form(...),
    source: str = Form("browser"),
):
    updated_bus = (
        await db.update_bus_location(
            bus_number,
            latitude,
            longitude,
            source,
        )
    )

    if not updated_bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found",
        )

    await broadcast(
        "bus_location_update",
        {
            "bus_number": bus_number,
            "latitude": latitude,
            "longitude": longitude,
            "source": source,
            "timestamp": updated_bus[
                "last_updated"
            ],
        },
    )

    return updated_bus


# =========================================================
# ROUTES
# =========================================================

@app.get("/api/routes")
async def api_get_routes():
    return await db.get_routes()


@app.get(
    "/api/routes/{bus_number}"
)
async def api_get_route(
    bus_number: str
):
    route = (
        await db.get_route_by_bus_number(
            bus_number
        )
    )

    if not route:
        raise HTTPException(
            status_code=404,
            detail="Route not found",
        )

    return route


# =========================================================
# POTHOLES
# =========================================================

@app.get("/api/potholes")
async def api_get_potholes(
    bus_number: Optional[str] = None,
    limit: int = 100,
):
    if bus_number:
        return await db.get_incidents(
            inc_type="pothole",
            bus_number=bus_number,
            limit=limit,
        )

    return await db.get_incidents(
        inc_type="pothole",
        limit=limit,
    )


@app.get(
    "/api/buses/{bus_number}/potholes"
)
async def api_get_bus_potholes(
    bus_number: str,
    limit: int = 100,
):
    return await db.get_incidents(
        inc_type="pothole",
        bus_number=bus_number,
        limit=limit,
    )


@app.post(
    "/api/buses/{bus_number}/potholes"
)
async def api_create_bus_pothole(
    bus_number: str,
    pothole: PotholeCreate,
):
    bus = await db.get_bus_by_number(
        bus_number
    )

    if not bus:
        raise HTTPException(
            status_code=404,
            detail="Bus not found",
        )

    incident = await db.create_incident(
        inc_type="pothole",
        severity=pothole.severity,
        confidence=pothole.confidence,
        lat=pothole.lat,
        lng=pothole.lng,
        video_id=pothole.video_id,
        description=pothole.description,
    )

    if not incident:
        raise HTTPException(
            status_code=400,
            detail="Failed to create pothole",
        )

    return incident


@app.patch(
    "/api/potholes/{pothole_id}"
)
async def api_update_pothole(
    pothole_id: str,
    pothole: PotholeUpdate,
):
    updates = {
        k: v
        for k, v in pothole.model_dump().items()
        if v is not None
    }

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No fields to update",
        )

    updated = await db.update_incident(
        pothole_id,
        **updates,
    )

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Pothole not found",
        )

    return updated


# =========================================================
# RUN SERVER
# =========================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )