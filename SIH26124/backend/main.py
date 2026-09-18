"""
RoadGuard AI — FastAPI Backend
REST API + WebSocket for real-time updates.
"""
import os
import uuid
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

import database as db
from ai_engine import AIDetectionEngine
from video_processor import VideoProcessor, UPLOAD_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Globals ─────────────────────────────────────────────
ai_engine: AIDetectionEngine = None
video_processor: VideoProcessor = None
ws_connections: set[WebSocket] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ai_engine, video_processor
    await db.init_db()
    ai_engine = AIDetectionEngine()
    video_processor = VideoProcessor(ai_engine)
    logger.info("RoadGuard AI backend started")
    yield
    logger.info("RoadGuard AI backend stopped")


app = FastAPI(title="RoadGuard AI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded files
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# ── Pydantic Models ─────────────────────────────────────
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


# ── WebSocket ───────────────────────────────────────────
async def broadcast(event_type: str, data: dict):
    """Send event to all connected WebSocket clients."""
    global ws_connections
    message = json.dumps({"event": event_type, "data": data})
    dead = set()
    for ws in ws_connections:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    ws_connections -= dead


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    ws_connections.add(ws)
    logger.info(f"WebSocket connected ({len(ws_connections)} total)")
    try:
        while True:
            await ws.receive_text()  # Keep alive
    except WebSocketDisconnect:
        ws_connections.discard(ws)
        logger.info(f"WebSocket disconnected ({len(ws_connections)} total)")


# ── Stats ───────────────────────────────────────────────
@app.get("/api/stats")
async def get_stats():
    return await db.get_stats()


# ── Videos ──────────────────────────────────────────────
@app.post("/api/videos/upload")
async def upload_video(
    file: UploadFile = File(...),
    gps_lat: Optional[float] = Form(None),
    gps_lng: Optional[float] = Form(None),
    gps_end_lat: Optional[float] = Form(None),
    gps_end_lng: Optional[float] = Form(None),
):
    ext = os.path.splitext(file.filename)[1] or ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)

    video = await db.create_video(
        filename=filename,
        original_name=file.filename,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        gps_end_lat=gps_end_lat,
        gps_end_lng=gps_end_lng,
    )
    return video


@app.post("/api/videos/{video_id}/process")
async def start_processing(video_id: int):
    video = await db.get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    if video["status"] == "processing":
        raise HTTPException(400, "Already processing")

    async def notify(event_type, data):
        await broadcast(event_type, data)

    # Run in background
    asyncio.create_task(video_processor.process_video(video_id, notify))
    return {"status": "started", "video_id": video_id}


@app.get("/api/videos/{video_id}/status")
async def video_status(video_id: int):
    video = await db.get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    job = video_processor.get_job_status(video_id)
    return {**video, "job": job}


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": "RoadGuard AI"}


@app.get("/api/videos")
async def list_videos(limit: int = 50):
    return await db.get_videos(limit=limit)


# ── Incidents ───────────────────────────────────────────
@app.get("/api/incidents")
async def list_incidents(
    status: Optional[str] = None,
    type: Optional[str] = None,
    severity: Optional[str] = None,
    video_id: Optional[int] = None,
    limit: int = 100,
):
    return await db.get_incidents(status=status, inc_type=type, severity=severity, video_id=video_id, limit=limit)


@app.post("/api/incidents")
async def create_incident(body: IncidentCreate):
    from incident_engine import create_manual_incident
    incident = await create_manual_incident(
        inc_type=body.type,
        severity=body.severity,
        lat=body.lat,
        lng=body.lng,
        description=body.description,
        confidence=body.confidence,
    )
    await broadcast("new_incident", incident)
    stats = await db.get_stats()
    await broadcast("stats_update", stats)
    return incident


@app.patch("/api/incidents/{incident_id}")
async def update_incident(incident_id: int, body: IncidentUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    incident = await db.update_incident(incident_id, **updates)
    if not incident:
        raise HTTPException(404, "Incident not found")
    await broadcast("incident_updated", incident)
    stats = await db.get_stats()
    await broadcast("stats_update", stats)
    return incident


@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: int):
    incident = await db.get_incident(incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    return incident


@app.delete("/api/incidents/{incident_id}")
async def delete_incident(incident_id: int):
    existing = await db.get_incident(incident_id)
    if not existing:
        raise HTTPException(404, "Incident not found")
    await db.delete_incident(incident_id)
    await broadcast("incident_deleted", {"id": incident_id})
    stats = await db.get_stats()
    await broadcast("stats_update", stats)
    return {"status": "deleted", "id": incident_id}


# ── Detections ──────────────────────────────────────────
@app.get("/api/detections")
async def list_detections(video_id: Optional[int] = None, limit: int = 100):
    return await db.get_detections(video_id=video_id, limit=limit)


# ── AI Engine Info ──────────────────────────────────────
@app.get("/api/ai/info")
async def ai_info():
    return ai_engine.get_engine_info()


@app.get("/api/ai/categories")
async def ai_categories():
    return {
        "categories": ["VEHICLE", "PEDESTRIAN", "ROAD ISSUE"],
        "supported_classes": SUPPORTED_DETECTION_CLASSES if 'SUPPORTED_DETECTION_CLASSES' in globals() else [],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
