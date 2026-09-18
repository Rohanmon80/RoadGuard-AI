"""
RoadGuard AI — Video Processor

Processes uploaded videos and permanently writes AI bounding boxes,
labels and confidence values into backend/processed_videos/.

Important:
- Individual detection records are NOT saved to the database.
- Incidents are NOT created from detections.
- The database is used only for video metadata/status/progress.
"""

import cv2
import os
import asyncio
import logging
from collections import Counter

from ai_engine import AIDetectionEngine
import database as db

logger = logging.getLogger(__name__)

# ============================================================
# DIRECTORIES
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
PROCESSED_DIR = os.path.join(BASE_DIR, "processed_videos")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)


# ============================================================
# PROCESSING SETTINGS
# ============================================================

# IMPORTANT:
# Every frame is processed so bounding boxes are actually visible
# throughout the uploaded video instead of appearing only every
# fifth frame.
FRAME_SKIP = 1

# AI confidence threshold is controlled by AIDetectionEngine.
# 0.25 is a practical starting point for a demo.
CONFIDENCE_THRESHOLD = 0.25


class VideoProcessor:
    def __init__(self, ai_engine: AIDetectionEngine):
        self.ai_engine = ai_engine
        self.active_jobs = {}

    async def process_video(
        self,
        video_id: int,
        notify_callback=None,
    ):
        logger.info(
            "Starting video processing: %s",
            video_id,
        )

        video = await db.get_video(video_id)

        if not video:
            logger.error("Video %s not found", video_id)
            return None

        filename = video.get("filename")
        if not filename:
            await db.update_video(
                video_id,
                status="error",
            )
            return None

        filepath = os.path.join(
            UPLOAD_DIR,
            filename,
        )

        if not os.path.exists(filepath):
            logger.error(
                "Video file not found: %s",
                filepath,
            )
            await db.update_video(
                video_id,
                status="error",
            )
            return None

        cap = cv2.VideoCapture(filepath)

        if not cap.isOpened():
            logger.error(
                "Cannot open video: %s",
                filepath,
            )
            await db.update_video(
                video_id,
                status="error",
            )
            return None

        total_frames = int(
            cap.get(cv2.CAP_PROP_FRAME_COUNT)
        )
        fps = float(
            cap.get(cv2.CAP_PROP_FPS)
        )

        if not fps or fps <= 0:
            fps = 30.0

        width = int(
            cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        )
        height = int(
            cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        )

        if width <= 0 or height <= 0:
            logger.error(
                "Invalid video dimensions: %sx%s",
                width,
                height,
            )
            cap.release()
            await db.update_video(
                video_id,
                status="error",
            )
            return None

        duration = (
            total_frames / fps
            if total_frames > 0
            else 0
        )

        logger.info(
            "Video information: frames=%s fps=%.2f "
            "size=%sx%s duration=%.2fs",
            total_frames,
            fps,
            width,
            height,
            duration,
        )

        await db.update_video(
            video_id,
            total_frames=total_frames,
            duration=round(duration, 2),
            status="processing",
            processed_frames=0,
        )

        name_without_ext = os.path.splitext(
            filename
        )[0]

        output_filename = (
            f"{name_without_ext}_annotated.mp4"
        )
        output_path = os.path.join(
            PROCESSED_DIR,
            output_filename,
        )

        # mp4v is broadly available through OpenCV.
        fourcc = cv2.VideoWriter_fourcc(
            *"mp4v"
        )

        writer = cv2.VideoWriter(
            output_path,
            fourcc,
            fps,
            (width, height),
        )

        if not writer.isOpened():
            logger.error(
                "Could not create output video: %s",
                output_path,
            )
            cap.release()
            await db.update_video(
                video_id,
                status="error",
            )
            return None

        self.active_jobs[video_id] = {
            "status": "processing",
            "total_frames": total_frames,
            "processed_frames": 0,
            "detections_count": 0,
            "counts": {
                "pothole": 0,
                "car": 0,
                "bus": 0,
                "bike": 0,
                "truck": 0,
                "pedestrian": 0,
            },
            "output_filename": output_filename,
            "output_path": output_path,
        }

        frame_number = 0
        detection_counter = Counter()

        try:
            while True:
                ret, frame = cap.read()

                if not ret:
                    break

                # ------------------------------------------------
                # AI detection on every frame
                # ------------------------------------------------
                try:
                    if frame_number % FRAME_SKIP == 0:
                        detections, annotated_frame = (
                            self.ai_engine.detect_and_annotate(
                                frame,
                                frame_number,
                                show_labels=True,
                                show_confidence=True,
                                # Keep the video labels clean like
                                # the screenshot: CAR 92%, BIKE 88%, etc.
                                show_category=False,
                                show_center=False,
                            )
                        )

                        for detection in detections:
                            detection_type = (
                                detection.type.lower()
                            )
                            detection_counter[
                                detection_type
                            ] += 1

                    else:
                        detections = []
                        annotated_frame = frame

                except Exception as detection_error:
                    logger.exception(
                        "AI detection failed at frame %s: %s",
                        frame_number,
                        detection_error,
                    )
                    detections = []
                    annotated_frame = frame

                # ------------------------------------------------
                # Draw live count panel onto the actual output.
                # ------------------------------------------------
                annotated_frame = (
                    self._draw_count_panel(
                        annotated_frame,
                        detection_counter,
                    )
                )

                annotated_frame = (
                    self._draw_processing_info(
                        annotated_frame,
                        frame_number + 1,
                        total_frames,
                    )
                )

                writer.write(annotated_frame)

                frame_number += 1

                counts = self._build_counts(
                    detection_counter
                )
                total_detections = sum(
                    detection_counter.values()
                )

                self.active_jobs[video_id][
                    "processed_frames"
                ] = frame_number

                self.active_jobs[video_id][
                    "detections_count"
                ] = total_detections

                self.active_jobs[video_id][
                    "counts"
                ] = counts

                # Update DB/websocket frequently, without writing
                # detection objects to the database.
                if (
                    frame_number == 1
                    or frame_number % 10 == 0
                    or frame_number == total_frames
                ):
                    progress = (
                        frame_number / total_frames * 100
                        if total_frames > 0
                        else 0
                    )

                    await db.update_video(
                        video_id,
                        processed_frames=frame_number,
                    )

                    if notify_callback:
                        await notify_callback(
                            "processing_progress",
                            {
                                "video_id": video_id,
                                "processed_frames": frame_number,
                                "total_frames": total_frames,
                                "progress": round(
                                    min(100.0, progress),
                                    1,
                                ),
                                "detections_count": (
                                    total_detections
                                ),
                                "counts": counts,
                            },
                        )

                # Let FastAPI's event loop continue.
                if frame_number % 10 == 0:
                    await asyncio.sleep(0)

        except Exception as error:
            logger.exception(
                "Error processing video %s: %s",
                video_id,
                error,
            )

            await db.update_video(
                video_id,
                status="error",
            )

            self.active_jobs[video_id][
                "status"
            ] = "error"

            return self.active_jobs[video_id]

        finally:
            cap.release()
            writer.release()

            logger.info(
                "Video resources released for %s",
                video_id,
            )

        final_counts = self._build_counts(
            detection_counter
        )
        total_detections = sum(
            detection_counter.values()
        )

        # Only video metadata is saved.
        await db.update_video(
            video_id,
            status="completed",
            processed_frames=total_frames,
        )

        self.active_jobs[video_id][
            "status"
        ] = "completed"

        self.active_jobs[video_id][
            "processed_frames"
        ] = total_frames

        self.active_jobs[video_id][
            "total_detections"
        ] = total_detections

        self.active_jobs[video_id][
            "counts"
        ] = final_counts

        if notify_callback:
            await notify_callback(
                "processing_complete",
                {
                    "video_id": video_id,
                    "total_detections": total_detections,
                    "counts": final_counts,
                    "output_filename": output_filename,
                    "output_url": (
                        f"/processed-videos/"
                        f"{output_filename}"
                    ),
                },
            )

        logger.info(
            "Video processing completed: %s",
            video_id,
        )
        logger.info(
            "Annotated video: %s",
            output_path,
        )
        logger.info(
            "Detection counts: %s",
            final_counts,
        )

        return self.active_jobs[video_id]

    @staticmethod
    def _build_counts(counter):
        return {
            "pothole": int(counter.get("pothole", 0)),
            "car": int(counter.get("car", 0)),
            "bus": int(counter.get("bus", 0)),
            "bike": int(counter.get("bike", 0)),
            "truck": int(counter.get("truck", 0)),
            "pedestrian": int(
                counter.get("pedestrian", 0)
            ),
        }

    @staticmethod
    def _draw_count_panel(frame, counter):
        if frame is None:
            return frame

        height, width = frame.shape[:2]

        panel_width = min(
            265,
            max(220, int(width * 0.24)),
        )
        panel_height = 235

        x1, y1 = 15, 15
        x2 = min(
            width - 10,
            x1 + panel_width,
        )
        y2 = min(
            height - 10,
            y1 + panel_height,
        )

        overlay = frame.copy()
        cv2.rectangle(
            overlay,
            (x1, y1),
            (x2, y2),
            (20, 20, 20),
            -1,
        )

        frame = cv2.addWeighted(
            overlay,
            0.78,
            frame,
            0.22,
            0,
        )

        cv2.putText(
            frame,
            "AI DETECTIONS",
            (x1 + 12, y1 + 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        cv2.line(
            frame,
            (x1 + 10, y1 + 40),
            (x2 - 10, y1 + 40),
            (150, 150, 150),
            1,
            cv2.LINE_AA,
        )

        items = [
            ("CARS", "car"),
            ("BUSES", "bus"),
            ("BIKES", "bike"),
            ("TRUCKS", "truck"),
            ("PEOPLE", "pedestrian"),
            ("POTHOLES", "pothole"),
        ]

        y = y1 + 68

        for label, key in items:
            count = int(counter.get(key, 0))

            cv2.putText(
                frame,
                label,
                (x1 + 15, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.50,
                (220, 220, 220),
                1,
                cv2.LINE_AA,
            )

            cv2.putText(
                frame,
                str(count),
                (x2 - 50, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.60,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            y += 29

        return frame

    @staticmethod
    def _draw_processing_info(
        frame,
        frame_number,
        total_frames,
    ):
        if frame is None:
            return frame

        height, width = frame.shape[:2]

        progress = (
            frame_number / total_frames * 100
            if total_frames > 0
            else 0
        )
        progress = min(
            100.0,
            max(0.0, progress),
        )

        text = (
            f"AI ANNOTATED  |  FRAME "
            f"{frame_number}/{total_frames}  "
            f"{progress:.1f}%"
        )

        # Draw a small dark background for readability.
        (tw, th), baseline = cv2.getTextSize(
            text,
            cv2.FONT_HERSHEY_SIMPLEX,
            0.50,
            2,
        )

        x = 15
        y = height - 18

        cv2.rectangle(
            frame,
            (x - 5, y - th - baseline - 5),
            (min(width - 5, x + tw + 5), y + 5),
            (20, 20, 20),
            -1,
        )

        cv2.putText(
            frame,
            text,
            (x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.50,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        return frame

    def get_job_status(self, video_id: int) -> dict | None:
        return self.active_jobs.get(video_id)
