import asyncio
import database as db
from ai_engine import AIDetectionEngine
from video_processor import VideoProcessor

async def test():
    await db.init_db()
    engine = AIDetectionEngine()
    proc = VideoProcessor(engine)
    video = await db.create_video(
        filename="sample_road_inspection.mp4",
        original_name="sample_road_inspection.mp4",
        gps_lat=22.5847,
        gps_lng=88.3582,
        gps_end_lat=22.5861,
        gps_end_lng=88.3690
    )
    print("Created video in DB:", video)
    
    events = []
    async def callback(event, data):
        events.append((event, data))
        if event in ("new_incident", "processing_complete"):
            print(f"[CALLBACK] {event}: {data}")

    result = await proc.process_video(video["id"], callback)
    print("Process result:", result)
    
    dets = await db.get_detections(video_id=video["id"])
    print(f"Detections in DB: {len(dets)}")
    incidents = await db.get_incidents()
    print(f"Incidents in DB: {len(incidents)}")
    stats = await db.get_stats()
    print("Stats in DB:", stats)

if __name__ == "__main__":
    asyncio.run(test())
