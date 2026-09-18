"""
Smart city intelligence — GPS Abstraction Layer
Provides multiple GPS strategies:
  - BrowserGPS: Uses browser navigator.geolocation (via frontend)
  - ManualGPS: Fixed user-entered coordinates
  - RouteGPS: Interpolates between start/end or waypoints
  - SoftwareGPS: Simulated movement for demo (neutral default)
  - HardwareGPS: Future interface for physical GPS modules

No hardcoded personal locations. All defaults are neutral.
"""
import math
import random
from dataclasses import dataclass
from typing import Optional, List, Tuple


# Neutral default demo location (configurable, not personal)
DEFAULT_DEMO_START = (0.0, 0.0)
DEFAULT_DEMO_END = (0.001, 0.001)


class GPSProvider:
    """Base interface — override get_position(frame_number, total_frames)."""
    def get_position(self, frame_number: int, total_frames: int) -> Tuple[float, float]:
        raise NotImplementedError

    def get_metadata(self) -> dict:
        """Return provider metadata for logging/debugging."""
        return {"type": self.__class__.__name__}


class BrowserGPS(GPSProvider):
    """
    Uses coordinates provided by the browser's navigator.geolocation.
    The frontend sends GPS with each frame or uses a single coordinate for the video.
    """
    def __init__(self, lat: float, lng: float, end_lat: Optional[float] = None, end_lng: Optional[float] = None):
        self.lat = lat
        self.lng = lng
        self.end_lat = end_lat
        self.end_lng = end_lng
        self._has_route = end_lat is not None and end_lng is not None

    def get_position(self, frame_number: int, total_frames: int) -> Tuple[float, float]:
        if self._has_route and total_frames > 1:
            progress = frame_number / (total_frames - 1)
            lat = self.lat + (self.end_lat - self.lat) * progress
            lng = self.lng + (self.end_lng - self.lng) * progress
            return round(lat, 6), round(lng, 6)
        return self.lat, self.lng

    def get_metadata(self) -> dict:
        return {
            "type": "BrowserGPS",
            "has_route": self._has_route,
            "start": (self.lat, self.lng),
            "end": (self.end_lat, self.end_lng) if self._has_route else None,
        }


class ManualGPS(GPSProvider):
    """Returns a fixed user-provided location (or interpolates if start+end given)."""
    def __init__(self, lat: float, lng: float, end_lat: Optional[float] = None, end_lng: Optional[float] = None):
        self.lat = lat
        self.lng = lng
        self.end_lat = end_lat
        self.end_lng = end_lng
        self._has_route = end_lat is not None and end_lng is not None

    def get_position(self, frame_number: int, total_frames: int) -> Tuple[float, float]:
        if self._has_route and total_frames > 1:
            progress = frame_number / (total_frames - 1)
            lat = self.lat + (self.end_lat - self.lat) * progress
            lng = self.lng + (self.end_lng - self.lng) * progress
            return round(lat, 6), round(lng, 6)
        return self.lat, self.lng

    def get_metadata(self) -> dict:
        return {
            "type": "ManualGPS",
            "has_route": self._has_route,
            "start": (self.lat, self.lng),
            "end": (self.end_lat, self.end_lng) if self._has_route else None,
        }


class RouteGPS(GPSProvider):
    """Interpolates along a list of waypoints [(lat, lng), ...]."""
    def __init__(self, waypoints: List[Tuple[float, float]]):
        if not waypoints or len(waypoints) < 2:
            raise ValueError("Need at least 2 waypoints")
        self.waypoints = waypoints

    def get_position(self, frame_number: int, total_frames: int) -> Tuple[float, float]:
        if total_frames <= 1:
            return self.waypoints[0]
        progress = frame_number / (total_frames - 1)
        total_segments = len(self.waypoints) - 1
        seg_float = progress * total_segments
        seg_idx = min(int(seg_float), total_segments - 1)
        seg_progress = seg_float - seg_idx
        lat1, lng1 = self.waypoints[seg_idx]
        lat2, lng2 = self.waypoints[seg_idx + 1]
        lat = lat1 + (lat2 - lat1) * seg_progress
        lng = lng1 + (lng2 - lng1) * seg_progress
        return round(lat, 6), round(lng, 6)

    def get_metadata(self) -> dict:
        return {
            "type": "RouteGPS",
            "waypoints": self.waypoints,
            "num_segments": len(self.waypoints) - 1,
        }


class SoftwareGPS(GPSProvider):
    """
    Simulated movement for demo purposes.
    Uses a neutral configurable default (0,0) area unless overridden.
    """
    def __init__(self, start_lat: float = DEFAULT_DEMO_START[0], start_lng: float = DEFAULT_DEMO_START[1],
                 spread: float = 0.005):
        self.start_lat = start_lat
        self.start_lng = start_lng
        self.spread = spread

    def get_position(self, frame_number: int, total_frames: int) -> Tuple[float, float]:
        if total_frames <= 1:
            progress = 0
        else:
            progress = frame_number / (total_frames - 1)
        lat = self.start_lat + progress * self.spread + random.uniform(-0.001, 0.001)
        lng = self.start_lng + progress * self.spread + random.uniform(-0.001, 0.001)
        return round(lat, 6), round(lng, 6)

    def get_metadata(self) -> dict:
        return {
            "type": "SoftwareGPS",
            "start": (self.start_lat, self.start_lng),
            "spread": self.spread,
            "note": "Simulated demo movement — not real GPS",
        }


# Future: class HardwareGPS(GPSProvider):
#   def get_position(self, frame_number, total_frames): read from serial/USB GPS module
#   def get_metadata(self): return {"type": "HardwareGPS", "device": "..."}


@dataclass
class GPSConfig:
    """Configuration for GPS provider selection."""
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None
    end_lat: Optional[float] = None
    end_lng: Optional[float] = None
    waypoints: Optional[List[Tuple[float, float]]] = None
    source: str = "auto"  # "browser" | "manual" | "route" | "software" | "auto"

    def has_coordinates(self) -> bool:
        return self.start_lat is not None and self.start_lng is not None


def create_gps_provider(config: Optional[GPSConfig] = None, **kwargs) -> GPSProvider:
    """
    Factory — picks the best GPS provider from available config or kwargs.
    Priority: explicit waypoints > start+end > start only > neutral demo.
    """
    if config is None:
        config = GPSConfig(**kwargs)

    if config.waypoints and len(config.waypoints) >= 2:
        return RouteGPS(config.waypoints)
    if config.has_coordinates():
        if config.source == "browser":
            return BrowserGPS(config.start_lat, config.start_lng, config.end_lat, config.end_lng)
        if config.end_lat is not None and config.end_lng is not None:
            return ManualGPS(config.start_lat, config.start_lng, config.end_lat, config.end_lng)
        return ManualGPS(config.start_lat, config.start_lng)
    # Neutral demo fallback — no hardcoded personal location
    return SoftwareGPS()