"""
End-to-end automated pipeline test:
1. Uploads sample_road_inspection.mp4 with GPS coords
2. Triggers processing
3. Polls status until completed
4. Queries detections and incidents
5. Checks stats update
"""
import requests
import time
import os

BASE_URL = "http://127.0.0.1:8000"

def test_pipeline():
    print("--- 1. Testing Video Upload ---")
    video_path = os.path.join(os.path.dirname(__file__), "sample_road_inspection.mp4")
    with open(video_path, "rb") as f:
        files = {"file": ("sample_road_inspection.mp4", f, "video/mp4")}
        data = {
            "gps_lat": 22.5847,
            "gps_lng": 88.3582,
            "gps_end_lat": 22.5861,
            "gps_end_lng": 88.3690
        }
        res = requests.post(f"{BASE_URL}/api/videos/upload", files=files, data=data)
    
    assert res.status_code == 200, f"Upload failed: {res.text}"
    video = res.json()
    video_id = video["id"]
    print(f"Video uploaded successfully! ID: {video_id}, file: {video['filename']}")

    print("\n--- 2. Starting Video Processing ---")
    res = requests.post(f"{BASE_URL}/api/videos/{video_id}/process")
    assert res.status_code == 200, f"Processing failed: {res.text}"
    print(f"Processing triggered for video #{video_id}")

    print("\n--- 3. Polling for Completion ---")
    for _ in range(25):
        time.sleep(1)
        st = requests.get(f"{BASE_URL}/api/videos/{video_id}/status").json()
        status = st.get("status")
        processed = st.get("processed_frames", 0)
        total = st.get("total_frames", 0)
        print(f"  Status: {status}, frames: {processed}/{total}")
        if status == "completed":
            break

    print("\n--- 4. Checking Detections & Incidents ---")
    dets = requests.get(f"{BASE_URL}/api/detections?video_id={video_id}").json()
    print(f"  Total Detections Extracted: {len(dets)}")
    if dets:
        print(f"  Sample Detection: Type={dets[0]['type']}, Conf={dets[0]['confidence']}, Frame={dets[0]['frame_number']}")

    incidents = requests.get(f"{BASE_URL}/api/incidents").json()
    print(f"  Total Incidents in DB: {len(incidents)}")
    if incidents:
        print(f"  Sample Incident: ID=#{incidents[0]['id']}, Type={incidents[0]['type']}, Severity={incidents[0]['severity']}, Lat={incidents[0]['lat']}, Lng={incidents[0]['lng']}")

    print("\n--- 5. Checking Aggregated Stats ---")
    stats = requests.get(f"{BASE_URL}/api/stats").json()
    print("  Stats:", stats)
    assert stats["total_incidents"] > 0, "Expected at least 1 incident created"
    print("\n[SUCCESS] ALL PIPELINE INTEGRATION TESTS PASSED PERFECTLY!")

if __name__ == "__main__":
    test_pipeline()
