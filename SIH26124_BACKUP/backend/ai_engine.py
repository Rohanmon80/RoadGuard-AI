"""
BusSense AI — AI Detection Engine
Uses YOLOv8n for vehicles and pedestrians; OpenCV fallback for road defects.
Configurable confidence thresholds and clean abstraction for future models.
"""
import cv2
import numpy as np
import os
import logging

logger = logging.getLogger(__name__)

# ── YOLO COCO Class Mapping ────────────────────────────
COCO_MAP = {
    0: "pedestrian",
    1: "bike",
    2: "car",
    3: "bike",
    5: "bus",
    7: "truck",
}

# ── Detection Category Mapping ─────────────────────────
# Required response: type, confidence, bbox, frame_number, category
CATEGORY_MAP = {
    "pedestrian": "PEDESTRIAN",
    "bike": "VEHICLE",
    "car": "VEHICLE",
    "bus": "VEHICLE",
    "truck": "VEHICLE",
    "pothole": "ROAD ISSUE",
    "road_damage": "ROAD ISSUE",
}

# ── Default Configurable Confidence Thresholds ─────────
DEFAULT_CONFIDENCE_THRESHOLDS = {
    "pedestrian": 0.35,
    "bike": 0.35,
    "car": 0.35,
    "bus": 0.35,
    "truck": 0.35,
    "pothole": 0.35,
    "road_damage": 0.35,
    "yolo_global": 0.35,
}

SUPPORTED_DETECTION_CLASSES = [
    "pedestrian", "bike", "car", "bus", "truck",
    "pothole", "road_damage",
]


class Detection:
    __slots__ = ("type", "confidence", "bbox", "frame_number", "category", "source")

    def __init__(self, det_type: str, confidence: float, bbox: tuple,
                 frame_number: int, category: str = None, source: str = "yolo"):
        self.type = det_type
        self.confidence = float(confidence)
        self.bbox = bbox  # (x, y, w, h) absolute in frame
        self.frame_number = int(frame_number)
        self.category = category if category else CATEGORY_MAP.get(det_type, "VEHICLE")
        self.source = source

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "confidence": round(self.confidence, 4),
            "bbox": {
                "x": int(self.bbox[0]),
                "y": int(self.bbox[1]),
                "w": int(self.bbox[2]),
                "h": int(self.bbox[3]),
            },
            "frame_number": self.frame_number,
            "category": self.category,
            "source": self.source,
        }


class RoadDefectDetector:
    """Abstract base for custom pothole / road-damage models."""
    def detect(self, frame: np.ndarray, frame_number: int) -> list:
        raise NotImplementedError("Implement detect() in subclass")


class OpenCVRoadDefectFallback(RoadDefectDetector):
    """Existing OpenCV multi-strategy pothole detector — preserved, modular."""

    def __init__(self, min_area_factor=0.001, max_area_factor=0.20, min_circularity=0.15):
        self.min_area_factor = min_area_factor
        self.max_area_factor = max_area_factor
        self.min_circularity = min_circularity

    def detect(self, frame: np.ndarray, frame_number: int) -> list[Detection]:
        return self._detect_potholes_cv(frame, frame_number)

    def _detect_potholes_cv(self, frame: np.ndarray, frame_number: int) -> list[Detection]:
        h, w = frame.shape[:2]
        road_y_start = int(h * 0.4)
        road_region = frame[road_y_start:, :]
        gray = cv2.cvtColor(road_region, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (7, 7), 0)

        thresh_adaptive = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 31, 6
        )
        median_val = np.median(blurred)
        dark_threshold = max(median_val - 30, 15)
        _, thresh_dark = cv2.threshold(blurred, int(dark_threshold), 255, cv2.THRESH_BINARY_INV)
        combined = cv2.bitwise_or(thresh_adaptive, thresh_dark)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
        combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        detections = []
        road_h = h - road_y_start
        min_area = w * road_h * self.min_area_factor
        max_area = w * road_h * self.max_area_factor

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area or area > max_area:
                continue
            perimeter = cv2.arcLength(cnt, True)
            if perimeter == 0:
                continue
            circularity = 4 * np.pi * area / (perimeter * perimeter)
            if circularity < self.min_circularity:
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            mask = np.zeros(gray.shape[:2], dtype=np.uint8)
            cv2.drawContours(mask, [cnt], -1, 255, -1)
            mean_inside = cv2.mean(gray, mask=mask)[0]
            kernel_big = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
            surround_mask = cv2.dilate(mask, kernel_big) - mask
            mean_surround = cv2.mean(gray, mask=surround_mask)[0] if cv2.countNonZero(surround_mask) > 0 else median_val
            darkness_ratio = mean_inside / max(mean_surround, 1)
            if darkness_ratio > 0.85:
                continue
            size_score = min(area / (w * road_h * 0.01), 1.0)
            contrast_score = max(0, 1.0 - darkness_ratio) * 1.5
            conf = min(0.35 + circularity * 0.25 + size_score * 0.15 + contrast_score * 0.25, 0.92)
            detections.append(Detection(
                det_type="pothole",
                confidence=round(conf, 4),
                bbox=(x, y + road_y_start, bw, bh),
                frame_number=frame_number,
                category="ROAD ISSUE",
                source="opencv_pothole",
            ))
        return detections


class AIDetectionEngine:
    def __init__(self, confidence_thresholds=None, road_defect_detector=None):
        self.confidence_thresholds = confidence_thresholds if confidence_thresholds is not None else DEFAULT_CONFIDENCE_THRESHOLDS.copy()
        self.yolo_model = None
        self.use_yolo = False
        self._load_yolo()
        self.road_defect_detector = road_defect_detector or OpenCVRoadDefectFallback()

    def set_confidence_threshold(self, det_type: str, value: float):
        self.confidence_thresholds[det_type] = float(value)

    def get_confidence_threshold(self, det_type: str) -> float:
        return self.confidence_thresholds.get(det_type, 0.5)

    def _load_yolo(self):
        try:
            from ultralytics import YOLO
            model_path = os.path.join(os.path.dirname(__file__), "yolov8n.pt")
            if not os.path.exists(model_path):
                self.yolo_model = YOLO("yolov8n.pt")
            else:
                self.yolo_model = YOLO(model_path)
            self.use_yolo = True
            logger.info("YOLOv8n model loaded")
        except Exception as e:
            logger.warning(f"YOLO unavailable: {e}")
            self.use_yolo = False

    def detect(self, frame: np.ndarray, frame_number: int) -> list[Detection]:
        detections = []
        if self.use_yolo:
            detections.extend(self._yolo_detect(frame, frame_number))
        detections.extend(self.road_defect_detector.detect(frame, frame_number))
        return detections

    def _yolo_detect(self, frame: np.ndarray, frame_number: int) -> list[Detection]:
        conf_global = self.confidence_thresholds.get("yolo_global", 0.35)
        results = self.yolo_model(frame, verbose=False, conf=conf_global)
        detections = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls_id = int(box.cls[0])
                if cls_id not in COCO_MAP:
                    continue
                conf = float(box.conf[0])
                det_type = COCO_MAP[cls_id]
                if conf < self.confidence_thresholds.get(det_type, conf_global):
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append(Detection(
                    det_type=det_type,
                    confidence=conf,
                    bbox=(int(x1), int(y1), int(x2 - x1), int(y2 - y1)),
                    frame_number=frame_number,
                    category=CATEGORY_MAP.get(det_type, "VEHICLE"),
                    source="yolo",
                ))
        return detections

    def get_engine_info(self) -> dict:
        return {
            "yolo_available": self.use_yolo,
            "supported_classes": SUPPORTED_DETECTION_CLASSES,
            "categories": ["VEHICLE", "PEDESTRIAN", "ROAD ISSUE"],
            "confidence_thresholds": self.confidence_thresholds,
            "road_defect_detector": self.road_defect_detector.__class__.__name__,
            "vehicle_method": "yolov8n" if self.use_yolo else "unavailable",
            "road_issue_method": "opencv_multi_strategy" if isinstance(self.road_defect_detector, OpenCVRoadDefectFallback) else self.road_defect_detector.__class__.__name__,
        }
