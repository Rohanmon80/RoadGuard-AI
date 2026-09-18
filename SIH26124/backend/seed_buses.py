#!/usr/bin/env python3
"""
Seed script to insert the initial bus configuration into MongoDB.
Idempotent: will not create duplicates.
"""
import asyncio
import os
import sys

# Add the backend directory to the path so we can import database
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, seed_bus_routes, close_db_connections

async def main():
    try:
        await init_db()
        await seed_bus_routes()
        print("Seeding completed successfully.")
    except Exception as e:
        print(f"Error during seeding: {e}")
        sys.exit(1)
    finally:
        await close_db_connections()

if __name__ == "__main__":
    asyncio.run(main())