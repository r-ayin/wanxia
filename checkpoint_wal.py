"""WAL checkpoint — merge WAL into main DB to prevent data loss"""
import sqlite3, os

db = os.path.join(os.path.dirname(__file__), "data", "sunset.db")

conn = sqlite3.connect(db)
cur = conn.cursor()

# Before
cur.execute("PRAGMA wal_checkpoint")
before = cur.fetchall()
print(f"Before checkpoint: {before}")

# Force truncate
cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
after = cur.fetchall()
print(f"After checkpoint: {after}")

# Integrity
cur.execute("PRAGMA integrity_check")
print(f"Integrity: {cur.fetchone()[0]}")

# Table count
cur.execute("SELECT count(*) FROM sqlite_master WHERE type='table'")
print(f"Tables: {cur.fetchone()[0]}")

conn.close()

# File sizes
for f in ["sunset.db", "sunset.db-wal", "sunset.db-shm"]:
    p = os.path.join(os.path.dirname(__file__), "data", f)
    if os.path.exists(p):
        print(f"{f}: {os.path.getsize(p)} bytes")
    else:
        print(f"{f}: (deleted)")
