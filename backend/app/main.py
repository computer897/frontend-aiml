from __future__ import annotations

import csv
import io
import json
import sqlite3
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR.parent / "attendance.db"
DETECTION_INTERVAL_SECONDS = 5
PRESENT_THRESHOLD = 0.60
RETENTION_HOURS = 24


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def parse_timestamp(value: Any) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    raise ValueError("Unsupported timestamp format")


def format_duration(seconds: int) -> str:
    minutes = seconds // 60
    remainder = seconds % 60
    if minutes and remainder:
        return f"{minutes}m {remainder}s"
    if minutes:
        return f"{minutes} min"
    return f"{remainder}s"


@contextmanager
def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS class_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id TEXT NOT NULL,
                session_id TEXT NOT NULL UNIQUE,
                class_title TEXT,
                teacher_name TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS engagement_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                student_name TEXT,
                section TEXT,
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL,
                face_detected INTEGER NOT NULL DEFAULT 0,
                multiple_faces INTEGER NOT NULL DEFAULT 0,
                face_count INTEGER NOT NULL DEFAULT 0,
                attention_score INTEGER NOT NULL DEFAULT 0,
                processing_location TEXT,
                detection_method TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_engagement_session_student
            ON engagement_events(session_id, student_id);

            CREATE INDEX IF NOT EXISTS idx_engagement_class_timestamp
            ON engagement_events(class_id, timestamp);

            CREATE TABLE IF NOT EXISTS attendance_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                student_name TEXT,
                section TEXT,
                attendance_status TEXT NOT NULL,
                engagement_time_seconds INTEGER NOT NULL,
                engagement_ratio REAL NOT NULL,
                class_duration_seconds INTEGER NOT NULL,
                class_date TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                archived_at TEXT,
                UNIQUE(session_id, student_id)
            );
            """
        )


def cleanup_expired_records(db: sqlite3.Connection) -> None:
    now_iso = to_iso(utc_now())
    db.execute(
        """
        UPDATE attendance_records
        SET archived_at = COALESCE(archived_at, ?)
        WHERE archived_at IS NULL AND expires_at < ?
        """,
        (now_iso, now_iso),
    )


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, class_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[class_id].append(websocket)

    def disconnect(self, class_id: str, websocket: WebSocket) -> None:
        if class_id not in self._connections:
            return
        self._connections[class_id] = [ws for ws in self._connections[class_id] if ws is not websocket]
        if not self._connections[class_id]:
            del self._connections[class_id]

    async def broadcast(self, class_id: str, payload: dict[str, Any]) -> None:
        for websocket in list(self._connections.get(class_id, [])):
            try:
                await websocket.send_text(json.dumps(payload))
            except Exception:
                self.disconnect(class_id, websocket)


manager = ConnectionManager()


class AttendanceStartRequest(BaseModel):
    class_id: str
    session_id: str
    class_title: str | None = None
    teacher_name: str | None = None
    started_at: str | int | float | None = None


class AttendanceMetadataRequest(BaseModel):
    student_id: str
    student_name: str | None = None
    section: str | None = None
    class_id: str
    session_id: str
    timestamp: str | int | float
    status: str = Field(default="not_detected")
    face_detected: bool = False
    multiple_faces: bool = False
    face_count: int = 0
    attention_score: int = 0
    processing_location: str | None = None
    detection_method: str | None = None


class AttendanceEndRequest(BaseModel):
    class_id: str
    session_id: str
    ended_at: str | int | float | None = None


app = FastAPI(title="Engagement Attendance API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_session_exists(db: sqlite3.Connection, payload: AttendanceStartRequest) -> sqlite3.Row:
    started_at = parse_timestamp(payload.started_at) if payload.started_at else utc_now()
    existing = db.execute(
        "SELECT * FROM class_sessions WHERE session_id = ?",
        (payload.session_id,),
    ).fetchone()

    if existing:
        db.execute(
            """
            UPDATE class_sessions
            SET class_title = COALESCE(?, class_title),
                teacher_name = COALESCE(?, teacher_name),
                updated_at = ?
            WHERE session_id = ?
            """,
            (payload.class_title, payload.teacher_name, to_iso(utc_now()), payload.session_id),
        )
        return db.execute(
            "SELECT * FROM class_sessions WHERE session_id = ?",
            (payload.session_id,),
        ).fetchone()

    now_iso = to_iso(utc_now())
    db.execute(
        """
        INSERT INTO class_sessions (
            class_id, session_id, class_title, teacher_name, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.class_id,
            payload.session_id,
            payload.class_title,
            payload.teacher_name,
            to_iso(started_at),
            now_iso,
            now_iso,
        ),
    )
    return db.execute(
        "SELECT * FROM class_sessions WHERE session_id = ?",
        (payload.session_id,),
    ).fetchone()


def compute_attendance_report(db: sqlite3.Connection, class_id: str, session_id: str) -> dict[str, Any]:
    cleanup_expired_records(db)
    session = db.execute(
        "SELECT * FROM class_sessions WHERE class_id = ? AND session_id = ?",
        (class_id, session_id),
    ).fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    started_at = parse_timestamp(session["started_at"])
    ended_at = parse_timestamp(session["ended_at"]) if session["ended_at"] else utc_now()
    duration_seconds = max(int((ended_at - started_at).total_seconds()), DETECTION_INTERVAL_SECONDS)

    events = db.execute(
        """
        SELECT * FROM engagement_events
        WHERE class_id = ? AND session_id = ?
        ORDER BY timestamp ASC
        """,
        (class_id, session_id),
    ).fetchall()

    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for event in events:
        grouped[event["student_id"]].append(event)

    rows: list[dict[str, Any]] = []
    for student_id, student_events in grouped.items():
        first = student_events[0]
        engaged_samples = sum(1 for event in student_events if event["status"] == "face_detected" or event["face_detected"])
        engagement_time_seconds = engaged_samples * DETECTION_INTERVAL_SECONDS
        engagement_ratio = min(engagement_time_seconds / duration_seconds, 1) if duration_seconds > 0 else 0
        attendance_status = "present" if engagement_ratio >= PRESENT_THRESHOLD else "absent"

        rows.append(
            {
                "student_id": student_id,
                "student_name": first["student_name"] or "Student",
                "section": first["section"] or "—",
                "attendance_status": attendance_status,
                "engagement_time_seconds": engagement_time_seconds,
                "engagement_time_minutes": round(engagement_time_seconds / 60, 1),
                "engagement_time_label": format_duration(engagement_time_seconds),
                "engagement_ratio": round(engagement_ratio, 4),
                "engagement_percentage": round(engagement_ratio * 100),
                "class_duration_seconds": duration_seconds,
                "class_duration_label": format_duration(duration_seconds),
                "class_date": started_at.date().isoformat(),
                "first_seen_at": first["timestamp"],
                "last_seen_at": student_events[-1]["timestamp"],
            }
        )

    rows.sort(key=lambda item: (item["attendance_status"] != "present", item["student_name"].lower()))
    return {
        "class_id": class_id,
        "session_id": session_id,
        "class_title": session["class_title"],
        "teacher_name": session["teacher_name"],
        "started_at": to_iso(started_at),
        "ended_at": to_iso(ended_at),
        "class_duration_seconds": duration_seconds,
        "class_duration_label": format_duration(duration_seconds),
        "attendance": rows,
        "attendance_records": rows,
    }


def persist_final_records(db: sqlite3.Connection, report: dict[str, Any]) -> None:
    cleanup_expired_records(db)
    created_at = to_iso(utc_now())
    expires_at = to_iso(utc_now() + timedelta(hours=RETENTION_HOURS))
    db.execute(
        "DELETE FROM attendance_records WHERE class_id = ? AND session_id = ?",
        (report["class_id"], report["session_id"]),
    )
    for row in report["attendance"]:
        db.execute(
            """
            INSERT INTO attendance_records (
                class_id, session_id, student_id, student_name, section,
                attendance_status, engagement_time_seconds, engagement_ratio,
                class_duration_seconds, class_date, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report["class_id"],
                report["session_id"],
                row["student_id"],
                row["student_name"],
                row["section"],
                row["attendance_status"],
                row["engagement_time_seconds"],
                row["engagement_ratio"],
                row["class_duration_seconds"],
                row["class_date"],
                expires_at,
                created_at,
            ),
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/attendance/start")
def start_attendance(payload: AttendanceStartRequest) -> dict[str, Any]:
    with get_db() as db:
        cleanup_expired_records(db)
        session = ensure_session_exists(db, payload)
        return {
            "class_id": session["class_id"],
            "session_id": session["session_id"],
            "started_at": session["started_at"],
        }


@app.post("/attendance/metadata")
async def submit_attendance_metadata(payload: AttendanceMetadataRequest) -> dict[str, Any]:
    event_time = parse_timestamp(payload.timestamp)
    with get_db() as db:
        cleanup_expired_records(db)
        ensure_session_exists(
            db,
            AttendanceStartRequest(
                class_id=payload.class_id,
                session_id=payload.session_id,
            ),
        )
        db.execute(
            """
            INSERT INTO engagement_events (
                class_id, session_id, student_id, student_name, section, timestamp,
                status, face_detected, multiple_faces, face_count, attention_score,
                processing_location, detection_method, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.class_id,
                payload.session_id,
                payload.student_id,
                payload.student_name,
                payload.section,
                to_iso(event_time),
                payload.status,
                int(payload.face_detected),
                int(payload.multiple_faces),
                payload.face_count,
                payload.attention_score,
                payload.processing_location,
                payload.detection_method,
                to_iso(utc_now()),
            ),
        )

    await manager.broadcast(
        payload.class_id,
        {
            "type": "engagement_update",
            "data": {
                "student_id": payload.student_id,
                "student_name": payload.student_name,
                "status": payload.status,
                "is_face_detected": payload.face_detected,
                "is_looking_at_screen": payload.attention_score >= 60,
                "engagement_percentage": 100 if payload.face_detected and not payload.multiple_faces else 40 if payload.multiple_faces else 0,
                "timestamp": to_iso(event_time),
            },
        },
    )
    return {"stored": True}


@app.post("/attendance/end")
async def end_attendance(payload: AttendanceEndRequest) -> dict[str, Any]:
    ended_at = parse_timestamp(payload.ended_at) if payload.ended_at else utc_now()
    with get_db() as db:
        cleanup_expired_records(db)
        session = db.execute(
            "SELECT * FROM class_sessions WHERE class_id = ? AND session_id = ?",
            (payload.class_id, payload.session_id),
        ).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Attendance session not found")
        db.execute(
            "UPDATE class_sessions SET ended_at = ?, updated_at = ? WHERE session_id = ?",
            (to_iso(ended_at), to_iso(utc_now()), payload.session_id),
        )
        report = compute_attendance_report(db, payload.class_id, payload.session_id)
        persist_final_records(db, report)

    await manager.broadcast(payload.class_id, {"type": "attendance_report", "data": report})
    return report


@app.get("/attendance/report/{class_id}")
def get_latest_class_report(class_id: str) -> dict[str, Any]:
    with get_db() as db:
        cleanup_expired_records(db)
        row = db.execute(
            """
            SELECT class_id, session_id
            FROM attendance_records
            WHERE class_id = ? AND archived_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (class_id,),
        ).fetchone()
        if not row:
            return {"class_id": class_id, "attendance": [], "attendance_records": []}
        return build_report_from_records(db, class_id, row["session_id"])


def build_report_from_records(db: sqlite3.Connection, class_id: str, session_id: str) -> dict[str, Any]:
    session = db.execute(
        "SELECT * FROM class_sessions WHERE class_id = ? AND session_id = ?",
        (class_id, session_id),
    ).fetchone()
    rows = db.execute(
        """
        SELECT *
        FROM attendance_records
        WHERE class_id = ? AND session_id = ? AND archived_at IS NULL
        ORDER BY attendance_status DESC, student_name COLLATE NOCASE ASC
        """,
        (class_id, session_id),
    ).fetchall()
    attendance = [
        {
            "student_id": row["student_id"],
            "student_name": row["student_name"],
            "section": row["section"],
            "attendance_status": row["attendance_status"],
            "engagement_time_seconds": row["engagement_time_seconds"],
            "engagement_time_minutes": round(row["engagement_time_seconds"] / 60, 1),
            "engagement_time_label": format_duration(row["engagement_time_seconds"]),
            "engagement_ratio": row["engagement_ratio"],
            "engagement_percentage": round(row["engagement_ratio"] * 100),
            "class_duration_seconds": row["class_duration_seconds"],
            "class_date": row["class_date"],
        }
        for row in rows
    ]
    return {
        "class_id": class_id,
        "session_id": session_id,
        "class_title": session["class_title"] if session else None,
        "teacher_name": session["teacher_name"] if session else None,
        "started_at": session["started_at"] if session else None,
        "ended_at": session["ended_at"] if session else None,
        "attendance": attendance,
        "attendance_records": attendance,
    }


@app.get("/attendance/report/{class_id}/{session_id}")
def get_session_report(class_id: str, session_id: str) -> dict[str, Any]:
    with get_db() as db:
        cleanup_expired_records(db)
        stored = db.execute(
            "SELECT 1 FROM attendance_records WHERE class_id = ? AND session_id = ? AND archived_at IS NULL LIMIT 1",
            (class_id, session_id),
        ).fetchone()
        if stored:
            return build_report_from_records(db, class_id, session_id)
        return compute_attendance_report(db, class_id, session_id)


@app.get("/attendance/student/{student_id}")
def get_student_history(student_id: str, hours: int = Query(default=24, ge=1, le=168)) -> dict[str, Any]:
    cutoff = to_iso(utc_now() - timedelta(hours=hours))
    with get_db() as db:
        cleanup_expired_records(db)
        rows = db.execute(
            """
            SELECT *
            FROM attendance_records
            WHERE student_id = ? AND archived_at IS NULL AND created_at >= ?
            ORDER BY created_at DESC
            """,
            (student_id, cutoff),
        ).fetchall()
        return {
            "student_id": student_id,
            "history": [
                {
                    "class_id": row["class_id"],
                    "session_id": row["session_id"],
                    "student_name": row["student_name"],
                    "section": row["section"],
                    "attendance_status": row["attendance_status"],
                    "engagement_time_seconds": row["engagement_time_seconds"],
                    "engagement_time_label": format_duration(row["engagement_time_seconds"]),
                    "class_date": row["class_date"],
                }
                for row in rows
            ],
        }


@app.get("/attendance/export/{class_id}/{session_id}")
def export_attendance_csv(class_id: str, session_id: str) -> Response:
    with get_db() as db:
        cleanup_expired_records(db)
        report = build_report_from_records(db, class_id, session_id)
        if not report["attendance"]:
            raise HTTPException(status_code=404, detail="No attendance records available for export")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Section", "Engagement Time", "Status", "Class Date"])
    for row in report["attendance"]:
        writer.writerow(
            [
                row["student_name"],
                row["section"],
                row["engagement_time_label"],
                row["attendance_status"].upper(),
                row["class_date"],
            ]
        )

    filename = f"attendance_{class_id}_{session_id}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.websocket("/attendance/ws/{class_id}")
async def attendance_websocket(websocket: WebSocket, class_id: str) -> None:
    await manager.connect(class_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(class_id, websocket)