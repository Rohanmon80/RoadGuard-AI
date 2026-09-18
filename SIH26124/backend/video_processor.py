"""
RoadGuard AI — Video Processor
Extracts frames from uploaded videos, runs AI detection, creates incidents.
"""
import cv2
import os
import asyncio
import logging
from ai_engine import AIDetectionEngine, Detection
from gps_service import create_gps_provider
import database as db
import incident_engine

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Process every Nth frame (adjustable)
FRAME_SKIP = 10


class VideoProcessor:
    def __init__(self, ai_engine: AIDetectionEngine):
        self.ai_engine = ai_engine
        self.active_jobs: dict[int, dict] = {}  # video_id → status

    async def process_video(self, video_id: int, notify_callback=None):
        """
        Main processing pipeline:
        1. Open video with OpenCV
        2. Extract every Nth frame
        3. Run AI detection
        4. Store detections in DB
        5. Create incidents from significant detections
        6. Report progress via callback
        """
        video = await db.get_video(video_id)
        if not video:
            logger.error(f"Video {video_id} not found")
            return

        filepath = os.path.join(UPLOAD_DIR, video["filename"])
        if not os.path.exists(filepath):
            logger.error(f"Video file not found: {filepath}")
            await db.update_video(video_id, status="error")
            return

        cap = cv2.VideoCapture(filepath)
        if not cap.isOpened():
            logger.error(f"Cannot open video: {filepath}")
            await db.update_video(video_id, status="error")
            return

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        duration = total_frames / fps if fps > 0 else 0

        await db.update_video(video_id, total_frames=total_frames,
                              duration=round(duration, 2), status="processing")

        # Setup GPS provider — prefer browser/manual coords from upload, else SoftwareGPS demo
        has_browser_gps = video.get("gps_lat") is not None and video.get("gps_lng") is not None
        gps = create_gps_provider(
            start_lat=video.get("gps_lat"),
            start_lng=video.get("gps_lng"),
            end_lat=video.get("gps_end_lat"),
            end_lng=video.get("gps_end_lng"),
            source="browser" if has_browser_gps else "auto",
        )

        self.active_jobs[video_id] = {
            "status": "processing",
            "total_frames": total_frames,
            "processed_frames": 0,
            "detections_count": 0,
            "incidents_count": 0,
        }

        frame_number = 0
        all_detections = []

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_number % FRAME_SKIP == 0:
                    # Run AI detection
                    detections = self.ai_engine.detect(frame, frame_number)

                    # Get GPS for this frame — attach to detections and incidents
                    lat, lng = gps.get_position(frame_number, total_frames)

                    for det in detections:
                        det_record = await db.create_detection(
                            video_id=video_id,
                            det_type=det.type,
                            confidence=det.confidence,
                            frame_number=det.frame_number,
                            bbox_x=det.bbox[0],
                            bbox_y=det.bbox[1],
                            bbox_w=det.bbox[2],
                            bbox_h=det.bbox[3],
                            lat=lat,
                            lng=lng,
                        )
                        all_detections.append(det_record)

                        if notify_callback:
                            await notify_callback("new_detection", det_record)

                        incident = await incident_engine.process_detection(
                            det_record, lat, lng, video_id=video_id
                        )

                        if incident and notify_callback:
                            self.active_jobs[video_id]["incidents_count"] += 1
                            await notify_callback("new_incident", incident)

                    self.active_jobs[video_id]["detections_count"] += len(detections)

                frame_number += 1
                self.active_jobs[video_id]["processed_frames"] = frame_number

                # Update DB progress periodically
                if frame_number % (FRAME_SKIP * 5) == 0:
                    await db.update_video(video_id, processed_frames=frame_number)
                    if notify_callback:
                        await notify_callback("processing_progress", {
                            "video_id": video_id,
                            "processed_frames": frame_number,
                            "total_frames": total_frames,
                            "progress": round(frame_number / total_frames * 100, 1),
                            "detections_count": self.active_jobs[video_id]["detections_count"],
                            "incidents_count": self.active_jobs[video_id]["incidents_count"],
                        })

                # Yield control to event loop periodically
                if frame_number % 30 == 0:
                    await asyncio.sleep(0)

        except Exception as e:
            logger.exception(f"Error processing video {video_id}: {e}")
            await db.update_video(video_id, status="error")
            self.active_jobs[video_id]["status"] = "error"
            return self.active_jobs[video_id]
        finally:
            cap.release()

        await db.update_video(video_id, status="completed",
                              processed_frames=total_frames)
        self.active_jobs[video_id]["status"] = "completed"
        self.active_jobs[video_id]["processed_frames"] = total_frames

        if notify_callback:
            stats = await db.get_stats()
            await notify_callback("processing_complete", {
                "video_id": video_id,
                "total_detections": self.active_jobs[video_id]["detections_count"],
                "total_incidents": self.active_jobs[video_id]["incidents_count"],
            })
            await notify_callback("stats_update", stats)

        return self.active_jobs[video_id]

    def get_job_status(self, video_id: int) -> dict | None:
        return self.active_jobs.get(video_id)
