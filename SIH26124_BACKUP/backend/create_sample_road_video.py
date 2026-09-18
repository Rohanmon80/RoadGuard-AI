"""
Generates a synthetic road test video with:
- Textured asphalt surface (noise for realism)
- High-contrast pothole anomalies (dark + shadow rings)
- Road cracks (jagged lines)
- Dashed lane markings and road edges
- A moving "vehicle" rectangle on one lane
"""
import cv2
import numpy as np
import os


def generate_road_video(filename="sample_road_inspection.mp4", num_frames=180, fps=30):
    width, height = 640, 360
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(filename, fourcc, fps, (width, height))
    rng = np.random.RandomState(42)

    for f in range(num_frames):
        # Base frame
        frame = np.zeros((height, width, 3), dtype=np.uint8)

        # Sky (upper 35%)
        sky_h = int(height * 0.35)
        frame[:sky_h, :] = [180, 140, 100]

        # Asphalt Road (lower 65%) — base gray + noise texture
        road = frame[sky_h:, :]
        road[:] = [80, 80, 85]  # Lighter asphalt for more contrast
        # Add grain noise so adaptive threshold has texture to work with
        noise = rng.randint(-12, 13, road.shape, dtype=np.int16)
        road[:] = np.clip(road.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        # Lane markings (dashed white center line)
        dash_offset = (f * 8) % 60
        for y in range(sky_h + dash_offset, height, 60):
            cv2.line(frame, (width // 2, y), (width // 2, min(height, y + 30)), (230, 230, 230), 4)

        # Road edges
        cv2.line(frame, (int(width * 0.1), sky_h), (int(width * 0.05), height), (200, 200, 200), 2)
        cv2.line(frame, (int(width * 0.9), sky_h), (int(width * 0.95), height), (200, 200, 200), 2)

        # ── Pothole 1: Large, high-contrast on right lane (frames 15–100) ──
        if 15 <= f <= 100:
            pot_y = int(height * 0.50 + (f - 15) * 2.0)
            pot_x = int(width * 0.65)
            if pot_y < height - 30:
                # Dark interior (near-black vs ~80 gray → Δ≈70)
                cv2.ellipse(frame, (pot_x, pot_y), (32, 22), 8, 0, 360, (10, 10, 10), -1)
                # Shadow ring
                cv2.ellipse(frame, (pot_x, pot_y), (36, 26), 8, 0, 360, (25, 25, 28), 3)
                # Outer highlight ring
                cv2.ellipse(frame, (pot_x, pot_y), (40, 30), 8, 0, 360, (50, 50, 55), 2)

        # ── Pothole 2: Smaller, left lane (frames 50–140) ──
        if 50 <= f <= 140:
            pot2_y = int(height * 0.45 + (f - 50) * 2.2)
            pot2_x = int(width * 0.32)
            if pot2_y < height - 25:
                cv2.ellipse(frame, (pot2_x, pot2_y), (26, 18), -12, 0, 360, (8, 8, 12), -1)
                cv2.ellipse(frame, (pot2_x, pot2_y), (30, 22), -12, 0, 360, (30, 30, 35), 3)

        # ── Pothole 3: Large crater, center-right (frames 110–170) ──
        if 110 <= f <= 170:
            pot3_y = int(height * 0.55 + (f - 110) * 1.8)
            pot3_x = int(width * 0.55)
            if pot3_y < height - 35:
                cv2.ellipse(frame, (pot3_x, pot3_y), (38, 28), 5, 0, 360, (5, 5, 8), -1)
                cv2.ellipse(frame, (pot3_x, pot3_y), (42, 32), 5, 0, 360, (28, 28, 32), 3)
                cv2.ellipse(frame, (pot3_x, pot3_y), (46, 36), 5, 0, 360, (55, 55, 58), 2)

        # ── Road crack: jagged dark line (frames 30–90) ──
        if 30 <= f <= 90:
            crack_y_start = int(height * 0.6)
            crack_x = int(width * 0.45) + int(np.sin(f * 0.3) * 15)
            pts = []
            for i in range(8):
                px = crack_x + rng.randint(-6, 7)
                py = crack_y_start + i * 8
                pts.append([px, py])
            pts = np.array(pts, np.int32).reshape((-1, 1, 2))
            cv2.polylines(frame, [pts], False, (15, 15, 18), 3)

        # ── Moving vehicle rectangle on left lane (frames 0–120) ──
        if f < 120:
            veh_y = int(height * 0.38 + f * 1.5)
            veh_x = int(width * 0.22)
            if veh_y < height - 40:
                cv2.rectangle(frame, (veh_x, veh_y), (veh_x + 50, veh_y + 35),
                              (30, 30, 180), -1)  # Blue-ish car
                cv2.rectangle(frame, (veh_x, veh_y), (veh_x + 50, veh_y + 35),
                              (20, 20, 120), 2)

        out.write(frame)

    out.release()
    print(f"Generated {filename} successfully ({num_frames} frames, {width}x{height})")


if __name__ == "__main__":
    generate_road_video(os.path.join(os.path.dirname(__file__), "sample_road_inspection.mp4"))
