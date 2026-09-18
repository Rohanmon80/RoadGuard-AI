"""
Smart city intelligence — AI Detection Engine

YOLO object detection + optional pothole model + OpenCV fallback.

The standard yolov8n.pt model detects COCO objects such as:
person, bicycle, car, bus and truck.

Potholes are NOT part of COCO.  This engine therefore:
1. Automatically looks for a custom pothole YOLO model if one exists.
2. Uses the custom model for potholes when found.
3. Falls back to a conservative OpenCV road-defect detector when no
   pothole-trained model is available.

Every detection can be rendered directly into the output video with:
- bounding box
- class label
- confidence
- category
- center point
"""

import cv2
import numpy as np
import os
import logging
from typing import List

logger = logging.getLogger(__name__)

# ============================================================
# CLASS / CATEGORY SETTINGS
# ============================================================

COCO_MAP = {
    0: "pedestrian",
    1: "bike",
    2: "car",
    3: "bike",       # motorcycle -> bike
    5: "bus",
    7: "truck",
}

CATEGORY_MAP = {
    "pedestrian": "PEDESTRIAN",
    "bike": "VEHICLE",
    "car": "VEHICLE",
    "bus": "VEHICLE",
    "truck": "VEHICLE",
    "pothole": "ROAD ISSUE",
    "road_damage": "ROAD ISSUE",
}

DEFAULT_CONFIDENCE_THRESHOLDS = {
    "pedestrian": 0.25,
    "bike": 0.25,
    "car": 0.25,
    "bus": 0.25,
    "truck": 0.25,
    "pothole": 0.25,
    "road_damage": 0.25,
    "yolo_global": 0.25,
}

SUPPORTED_DETECTION_CLASSES = [
    "pedestrian",
    "bike",
    "car",
    "bus",
    "truck",
    "pothole",
    "road_damage",
]


# ============================================================
# DETECTION OBJECT
# ============================================================

class Detection:
    """One detection. bbox = (x, y, width, height)."""

    __slots__ = (
        "type",
        "confidence",
        "bbox",
        "frame_number",
        "category",
        "source",
    )

    def __init__(
        self,
        det_type,
        confidence,
        bbox,
        frame_number,
        category=None,
        source="yolo",
    ):
        self.type = str(det_type)
        self.confidence = float(confidence)
        self.bbox = (
            int(bbox[0]),
            int(bbox[1]),
            int(bbox[2]),
            int(bbox[3]),
        )
        self.frame_number = int(frame_number)
        self.category = category or CATEGORY_MAP.get(
            self.type, "VEHICLE"
        )
        self.source = str(source)

    def to_dict(self):
        return {
            "type": self.type,
            "confidence": round(self.confidence, 4),
            "bbox": {
                "x": self.bbox[0],
                "y": self.bbox[1],
                "w": self.bbox[2],
                "h": self.bbox[3],
            },
            "frame_number": self.frame_number,
            "category": self.category,
            "source": self.source,
        }

    def __repr__(self):
        return (
            f"Detection(type={self.type!r}, "
            f"confidence={self.confidence:.2f}, "
            f"bbox={self.bbox}, "
            f"frame={self.frame_number}, "
            f"source={self.source!r})"
        )


# ============================================================
# OPENCV POTHOLE FALLBACK
# ============================================================

class OpenCVRoadDefectFallback:
    """
    Conservative visual fallback.

    This is not a trained pothole detector. It is only used when a
    pothole-trained YOLO model is unavailable.
    """

    def __init__(
        self,
        min_area_factor=0.004,
        max_area_factor=0.12,
        min_circularity=0.12,
    ):
        self.min_area_factor = float(min_area_factor)
        self.max_area_factor = float(max_area_factor)
        self.min_circularity = float(min_circularity)

    def detect(self, frame, frame_number) -> List[Detection]:
        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return []

        height, width = frame.shape[:2]
        if height < 100 or width < 100:
            return []

        # Road is normally in the lower ~55% of a forward-facing frame.
        road_y_start = int(height * 0.45)
        road = frame[road_y_start:, :]

        if road.size == 0:
            return []

        gray = cv2.cvtColor(road, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (7, 7), 0)

        # Use local contrast rather than a very aggressive dark threshold.
        blackhat_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (21, 21)
        )
        blackhat = cv2.morphologyEx(
            gray, cv2.MORPH_BLACKHAT, blackhat_kernel
        )

        _, mask = cv2.threshold(blackhat, 35, 255, cv2.THRESH_BINARY)

        cleanup = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (9, 9)
        )
        mask = cv2.morphologyEx(
            mask, cv2.MORPH_CLOSE, cleanup, iterations=2
        )
        mask = cv2.morphologyEx(
            mask, cv2.MORPH_OPEN, cleanup, iterations=1
        )

        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        frame_area = float(width * height)
        min_area = max(300.0, frame_area * self.min_area_factor)
        max_area = frame_area * self.max_area_factor

        detections = []

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue

            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue

            circularity = (
                4.0 * np.pi * area / (perimeter * perimeter)
            )
            if circularity < self.min_circularity:
                continue

            x, y, w, h = cv2.boundingRect(contour)
            if w < 15 or h < 10:
                continue

            aspect = w / float(h)
            if aspect < 0.20 or aspect > 5.0:
                continue

            roi = gray[
                max(0, y):min(gray.shape[0], y + h),
                max(0, x):min(gray.shape[1], x + w),
            ]
            if roi.size == 0:
                continue

            # A candidate should be visibly darker than its immediate
            # surroundings. This helps reject random road texture.
            pad = max(5, int(min(w, h) * 0.20))
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(gray.shape[1], x + w + pad)
            y2 = min(gray.shape[0], y + h + pad)
            surrounding = gray[y1:y2, x1:x2]

            inside_mean = float(np.mean(roi))
            outside_mean = float(np.mean(surrounding))
            contrast = outside_mean - inside_mean

            if contrast < 8.0:
                continue

            darkness = np.clip(contrast / 60.0, 0.0, 1.0)
            shape = np.clip(circularity / 0.75, 0.0, 1.0)
            size = np.clip(
                area / max(frame_area * 0.015, 1.0), 0.0, 1.0
            )

            confidence = (
                0.25
                + darkness * 0.40
                + shape * 0.25
                + size * 0.10
            )
            confidence = float(np.clip(confidence, 0.35, 0.90))

            detections.append(
                Detection(
                    "pothole",
                    confidence,
                    (x, y + road_y_start, w, h),
                    frame_number,
                    "ROAD ISSUE",
                    "opencv_pothole",
                )
            )

        return self._remove_overlaps(detections)

    @staticmethod
    def _remove_overlaps(detections, iou_threshold=0.40):
        kept = []
        for candidate in sorted(
            detections,
            key=lambda d: d.confidence,
            reverse=True,
        ):
            if all(
                OpenCVRoadDefectFallback._iou(
                    candidate.bbox, existing.bbox
                ) < iou_threshold
                for existing in kept
            ):
                kept.append(candidate)
        return kept

    @staticmethod
    def _iou(box_a, box_b):
        ax, ay, aw, ah = box_a
        bx, by, bw, bh = box_b

        ax2, ay2 = ax + aw, ay + ah
        bx2, by2 = bx + bw, by + bh

        ix1, iy1 = max(ax, bx), max(ay, by)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)

        iw = max(0, ix2 - ix1)
        ih = max(0, iy2 - iy1)
        intersection = iw * ih

        area_a = max(0, aw) * max(0, ah)
        area_b = max(0, bw) * max(0, bh)
        union = area_a + area_b - intersection

        return intersection / union if union > 0 else 0.0


# ============================================================
# MAIN AI ENGINE
# ============================================================

class AIDetectionEngine:
    def __init__(
        self,
        model_path="yolov8n.pt",
        confidence_threshold=0.25,
        enable_pothole_fallback=True,
        pothole_model_path=None,
    ):
        self.model = None
        self.pothole_model = None
        self.model_path = model_path
        self.pothole_model_path = pothole_model_path
        self.confidence_threshold = float(confidence_threshold)
        self.thresholds = DEFAULT_CONFIDENCE_THRESHOLDS.copy()
        self.thresholds["yolo_global"] = self.confidence_threshold
        self.yolo_available = False
        self.pothole_model_available = False
        self.pothole_detector = None

        self._load_yolo()
        self._load_pothole_model()

        if enable_pothole_fallback and not self.pothole_model_available:
            self.pothole_detector = OpenCVRoadDefectFallback()

        logger.info(
            "AI Detection Engine initialized | YOLO=%s | pothole_model=%s | "
            "opencv_fallback=%s",
            self.yolo_available,
            self.pothole_model_available,
            self.pothole_detector is not None,
        )

    # ========================================================
    # MODEL LOADING
    # ========================================================

    @staticmethod
    def _find_existing(paths):
        for path in paths:
            if path and os.path.isfile(path):
                return os.path.abspath(path)
        return None

    def _load_yolo(self):
        try:
            from ultralytics import YOLO
        except ImportError:
            logger.warning(
                "Ultralytics is not installed. YOLO detection is disabled."
            )
            return

        candidates = [
            self.model_path,
            os.path.join(os.path.dirname(__file__), "yolov8n.pt"),
            os.path.join(os.getcwd(), "yolov8n.pt"),
        ]

        local = self._find_existing(candidates)

        try:
            if local:
                logger.info("Loading YOLO model: %s", local)
                self.model = YOLO(local)
            else:
                logger.info("Loading YOLO model: yolov8n.pt")
                self.model = YOLO("yolov8n.pt")

            self.yolo_available = self.model is not None
            if self.yolo_available:
                logger.info("YOLO model loaded successfully")
        except Exception as exc:
            logger.exception("Failed to load YOLO model: %s", exc)
            self.model = None
            self.yolo_available = False

    def _load_pothole_model(self):
        """
        Look for a trained pothole model without requiring one.

        Supported filenames include:
          pothole_best.pt
          pothole.pt
          potholes.pt
          road_damage.pt
          best_pothole.pt
          pothole_model.pt
        """
        try:
            from ultralytics import YOLO
        except ImportError:
            return

        base = os.path.dirname(__file__)
        candidates = [
            self.pothole_model_path,
            os.path.join(base, "pothole_best.pt"),
            os.path.join(base, "pothole.pt"),
            os.path.join(base, "potholes.pt"),
            os.path.join(base, "road_damage.pt"),
            os.path.join(base, "best_pothole.pt"),
            os.path.join(base, "pothole_model.pt"),
            os.path.join(base, "models", "pothole_best.pt"),
            os.path.join(base, "models", "best.pt"),
        ]

        local = self._find_existing(candidates)
        if not local:
            logger.info(
                "No pothole-trained YOLO model found. "
                "Using OpenCV fallback if enabled."
            )
            return

        try:
            logger.info("Loading pothole YOLO model: %s", local)
            self.pothole_model = YOLO(local)
            self.pothole_model_path = local
            self.pothole_model_available = self.pothole_model is not None
            logger.info("Pothole YOLO model loaded successfully")
        except Exception as exc:
            logger.exception(
                "Failed to load pothole model: %s", exc
            )
            self.pothole_model = None
            self.pothole_model_available = False

    # ========================================================
    # DETECTION
    # ========================================================

    def detect(self, frame, frame_number=0) -> List[Detection]:
        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return []

        detections = []

        if self.yolo_available:
            try:
                detections.extend(
                    self._yolo_detect(frame, frame_number)
                )
            except Exception as exc:
                logger.exception(
                    "YOLO detection failed at frame %s: %s",
                    frame_number,
                    exc,
                )

        # Prefer a trained pothole detector when available.
        if self.pothole_model_available:
            try:
                detections.extend(
                    self._pothole_yolo_detect(frame, frame_number)
                )
            except Exception as exc:
                logger.exception(
                    "Pothole YOLO detection failed at frame %s: %s",
                    frame_number,
                    exc,
                )
        elif self.pothole_detector is not None:
            try:
                detections.extend(
                    self.pothole_detector.detect(
                        frame, frame_number
                    )
                )
            except Exception as exc:
                logger.exception(
                    "OpenCV pothole detection failed at frame %s: %s",
                    frame_number,
                    exc,
                )

        return detections

    def _predict(self, model, frame, conf):
        return model.predict(
            source=frame,
            conf=conf,
            iou=0.45,
            imgsz=640,
            max_det=100,
            verbose=False,
        )

    def _yolo_detect(self, frame, frame_number):
        detections = []
        results = self._predict(
            self.model,
            frame,
            self.confidence_threshold,
        )

        for result in results:
            if result is None or result.boxes is None:
                continue

            names = getattr(result, "names", {}) or {}

            for box in result.boxes:
                try:
                    class_id = int(box.cls[0].item())
                    if class_id not in COCO_MAP:
                        continue

                    det_type = COCO_MAP[class_id]
                    confidence = float(box.conf[0].item())

                    if confidence < self.thresholds.get(
                        det_type, self.confidence_threshold
                    ):
                        continue

                    xyxy = box.xyxy[0].cpu().numpy().tolist()
                    if len(xyxy) < 4:
                        continue

                    x1, y1, x2, y2 = map(
                        int, map(round, xyxy[:4])
                    )
                    x1, y1, x2, y2 = self._clamp_box(
                        frame, x1, y1, x2, y2
                    )

                    if x2 <= x1 or y2 <= y1:
                        continue

                    # Use the model's real class name where available
                    # only for logging/debugging; keep the application
                    # category names stable.
                    raw_name = names.get(class_id, det_type)

                    detections.append(
                        Detection(
                            det_type,
                            confidence,
                            (x1, y1, x2 - x1, y2 - y1),
                            frame_number,
                            CATEGORY_MAP.get(
                                det_type, "VEHICLE"
                            ),
                            f"yolo:{raw_name}",
                        )
                    )
                except Exception as exc:
                    logger.debug(
                        "Could not parse YOLO object: %s",
                        exc,
                    )

        return detections

    def _pothole_yolo_detect(self, frame, frame_number):
        detections = []
        results = self._predict(
            self.pothole_model,
            frame,
            self.thresholds["pothole"],
        )

        for result in results:
            if result is None or result.boxes is None:
                continue

            names = getattr(result, "names", {}) or {}

            for box in result.boxes:
                try:
                    class_id = int(box.cls[0].item())
                    confidence = float(box.conf[0].item())

                    raw_name = str(
                        names.get(class_id, "pothole")
                    ).lower()

                    # Custom pothole datasets sometimes call the class
                    # "hole", "road damage", etc.
                    is_pothole = any(
                        token in raw_name
                        for token in (
                            "pothole",
                            "pothole",
                            "hole",
                            "road_damage",
                            "road damage",
                            "damage",
                            "crack",
                        )
                    )

                    if not is_pothole:
                        # If this is a dedicated one-class pothole model,
                        # accept its class as pothole.
                        class_count = len(names)
                        is_pothole = class_count == 1

                    if not is_pothole:
                        continue

                    if confidence < self.thresholds["pothole"]:
                        continue

                    xyxy = box.xyxy[0].cpu().numpy().tolist()
                    x1, y1, x2, y2 = map(
                        int, map(round, xyxy[:4])
                    )
                    x1, y1, x2, y2 = self._clamp_box(
                        frame, x1, y1, x2, y2
                    )

                    if x2 <= x1 or y2 <= y1:
                        continue

                    detections.append(
                        Detection(
                            "pothole",
                            confidence,
                            (x1, y1, x2 - x1, y2 - y1),
                            frame_number,
                            "ROAD ISSUE",
                            f"pothole_yolo:{raw_name}",
                        )
                    )
                except Exception as exc:
                    logger.debug(
                        "Could not parse pothole detection: %s",
                        exc,
                    )

        return detections

    @staticmethod
    def _clamp_box(frame, x1, y1, x2, y2):
        height, width = frame.shape[:2]
        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(0, min(x2, width - 1))
        y2 = max(0, min(y2, height - 1))
        return x1, y1, x2, y2

    # ========================================================
    # ANNOTATION
    # ========================================================

    def draw_detections(
        self,
        frame,
        detections,
        show_labels=True,
        show_confidence=True,
        show_category=False,
        show_center=False,
        thickness=3,
    ):
        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return frame

        annotated = frame.copy()
        detections = detections or []
        height, width = annotated.shape[:2]

        for detection in detections:
            try:
                x, y, w, h = detection.bbox
                x1, y1, x2, y2 = self._clamp_box(
                    annotated,
                    int(x),
                    int(y),
                    int(x + w),
                    int(y + h),
                )

                if x2 <= x1 or y2 <= y1:
                    continue

                color = self._get_detection_color(detection)

                # Main box.
                cv2.rectangle(
                    annotated,
                    (x1, y1),
                    (x2, y2),
                    color,
                    max(2, int(thickness)),
                    cv2.LINE_AA,
                )

                # Strong corner accents like modern YOLO demos.
                self._draw_corner_box(
                    annotated,
                    x1, y1, x2, y2,
                    color,
                    max(2, int(thickness)),
                )

                if show_center:
                    cv2.circle(
                        annotated,
                        ((x1 + x2) // 2, (y1 + y2) // 2),
                        4,
                        color,
                        -1,
                        cv2.LINE_AA,
                    )

                label_parts = []
                if show_labels:
                    label_parts.append(
                        detection.type.upper()
                    )
                if show_confidence:
                    label_parts.append(
                        f"{detection.confidence * 100:.0f}%"
                    )
                if show_category:
                    label_parts.append(
                        detection.category
                    )

                label = " ".join(label_parts).strip()
                if not label:
                    continue

                font = cv2.FONT_HERSHEY_SIMPLEX

                # Scale labels for phone/portrait and landscape videos.
                font_scale = max(
                    0.45,
                    min(0.85, width / 1100.0),
                )
                text_thickness = 2

                (tw, th), baseline = cv2.getTextSize(
                    label,
                    font,
                    font_scale,
                    text_thickness,
                )

                # Put the label above the box when possible.
                label_x = max(0, x1)
                label_y = y1 - 8

                if label_y - th - baseline < 0:
                    label_y = min(
                        height - baseline - 2,
                        y1 + th + baseline + 8,
                    )

                bx1 = label_x
                by1 = max(
                    0,
                    label_y - th - baseline - 6,
                )
                bx2 = min(
                    width - 1,
                    label_x + tw + 12,
                )
                by2 = min(
                    height - 1,
                    label_y + baseline + 5,
                )

                # Solid label background.
                cv2.rectangle(
                    annotated,
                    (bx1, by1),
                    (bx2, by2),
                    color,
                    -1,
                )

                cv2.putText(
                    annotated,
                    label,
                    (label_x + 6, label_y),
                    font,
                    font_scale,
                    (255, 255, 255),
                    text_thickness,
                    cv2.LINE_AA,
                )

            except Exception as exc:
                logger.debug(
                    "Failed to draw detection: %s",
                    exc,
                )

        return annotated

    @staticmethod
    def _draw_corner_box(
        frame,
        x1, y1, x2, y2,
        color,
        thickness=3,
    ):
        w = max(1, x2 - x1)
        h = max(1, y2 - y1)
        length = int(
            min(32, max(10, min(w, h) * 0.22))
        )

        lines = [
            ((x1, y1), (x1 + length, y1)),
            ((x1, y1), (x1, y1 + length)),
            ((x2, y1), (x2 - length, y1)),
            ((x2, y1), (x2, y1 + length)),
            ((x1, y2), (x1 + length, y2)),
            ((x1, y2), (x1, y2 - length)),
            ((x2, y2), (x2 - length, y2)),
            ((x2, y2), (x2, y2 - length)),
        ]

        for start, end in lines:
            cv2.line(
                frame,
                start,
                end,
                color,
                thickness,
                cv2.LINE_AA,
            )

    @staticmethod
    def _get_detection_color(detection):
        t = detection.type.lower()

        if t in ("pothole", "road_damage"):
            return (0, 70, 255)       # BGR red/orange
        if t == "pedestrian":
            return (180, 0, 255)      # BGR pink
        if t == "bike":
            return (255, 120, 0)      # BGR blue
        if t == "car":
            return (255, 220, 0)      # BGR cyan
        if t == "bus":
            return (0, 220, 80)       # BGR green
        if t == "truck":
            return (0, 220, 255)      # BGR yellow

        return (255, 255, 255)

    def detect_and_annotate(
        self,
        frame,
        frame_number=0,
        show_labels=True,
        show_confidence=True,
        show_category=False,
        show_center=False,
    ):
        detections = self.detect(
            frame, frame_number
        )
        annotated = self.draw_detections(
            frame,
            detections,
            show_labels=show_labels,
            show_confidence=show_confidence,
            show_category=show_category,
            show_center=show_center,
        )
        return detections, annotated

    def annotate_frame(
        self,
        frame,
        detections,
        **kwargs,
    ):
        return self.draw_detections(
            frame, detections, **kwargs
        )

    # ========================================================
    # SERIALIZATION / INFO
    # ========================================================

    @staticmethod
    def detections_to_dict(detections):
        return [
            d.to_dict()
            for d in (detections or [])
            if d is not None
        ]

    def get_engine_info(self):
        return {
            "available": bool(
                self.yolo_available
                or self.pothole_model_available
                or self.pothole_detector is not None
            ),
            "yolo_available": self.yolo_available,
            "pothole_model_available": (
                self.pothole_model_available
            ),
            "pothole_fallback_available": (
                self.pothole_detector is not None
            ),
            "model": self.model_path
                if self.yolo_available else None,
            "pothole_model": self.pothole_model_path
                if self.pothole_model_available else None,
            "confidence_threshold": (
                self.confidence_threshold
            ),
            "supported_classes": (
                SUPPORTED_DETECTION_CLASSES.copy()
            ),
            "annotation": {
                "bounding_boxes": True,
                "labels": True,
                "confidence": True,
                "category": True,
                "center_point": True,
                "corner_highlight": True,
            },
            "pothole_note": (
                "A trained pothole YOLO model is used when a supported "
                "pothole .pt file is present. Otherwise the OpenCV "
                "fallback is used and is not equivalent to trained "
                "pothole detection."
            ),
        }


def create_ai_engine(
    model_path="yolov8n.pt",
    confidence_threshold=0.25,
    enable_pothole_fallback=True,
    pothole_model_path=None,
):
    return AIDetectionEngine(
        model_path=model_path,
        confidence_threshold=confidence_threshold,
        enable_pothole_fallback=enable_pothole_fallback,
        pothole_model_path=pothole_model_path,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    engine = AIDetectionEngine()
    print("Smart city intelligence Detection Engine")
    print("============================")
    print(engine.get_engine_info())
