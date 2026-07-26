"""Grading store + review API router for the voice-service call review flow.

Exposes `router` (APIRouter, prefix="/api/review") with:
  GET  /api/review/calls
  POST /api/review/calls/{file}/analyze?force=false&swap=false
  GET  /api/review/calls/{file}
  POST /api/review/calls/{file}/grade
  GET  /api/review/stats
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from analysis import RECORDINGS_DIR, analyze_call, get_analysis, wav_info

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "review.db"

GRADE_DIMS = ("naturalness", "task_completion", "compliance", "language_quality")

# {YYYYMMDD-HHMMSS}_{CallSid}_{RecordingSid}.wav
_NAME_RE = re.compile(r"^(\d{8}-\d{6})_([^_]+)_([^_]+)\.wav$")

_db_lock = threading.Lock()
_db = sqlite3.connect(str(DB_PATH), check_same_thread=False)
_db.row_factory = sqlite3.Row
with _db_lock:
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute(
        """
        CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file TEXT NOT NULL,
            grader TEXT NOT NULL DEFAULT '',
            overall INTEGER NOT NULL,
            scores TEXT NOT NULL DEFAULT '{}',
            tags TEXT NOT NULL DEFAULT '[]',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    _db.execute("CREATE INDEX IF NOT EXISTS idx_grades_file ON grades(file)")
    _db.commit()

router = APIRouter(prefix="/api/review")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _safe_name(file: str) -> str:
    """Validate a {file} path param; 404 unless it is a plain existing .wav name."""
    name = Path(file).name
    if name != file or not name.endswith(".wav") or not (RECORDINGS_DIR / name).is_file():
        raise HTTPException(status_code=404, detail="recording not found")
    return name


def _parse_name(name: str) -> Tuple[str, str, Optional[datetime]]:
    """Return (call_sid, recording_sid, recorded_at_dt) from the filename pattern."""
    m = _NAME_RE.match(name)
    if m:
        ts, call_sid, recording_sid = m.groups()
        try:
            dt = datetime.strptime(ts, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
            return call_sid, recording_sid, dt
        except ValueError:
            pass
    return "", "", None


def _mtime_utc(path: Path) -> datetime:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return datetime.fromtimestamp(0, tz=timezone.utc)


def _duration_sec(path: Path) -> float:
    """Duration via analysis.wav_info, tolerant of its exact return shape."""
    try:
        info = wav_info(path)
    except Exception:
        return 0.0
    if isinstance(info, dict):
        for key in ("duration_sec", "duration", "seconds"):
            if key in info:
                try:
                    return float(info[key])
                except (TypeError, ValueError):
                    return 0.0
    for attr in ("duration_sec", "duration"):
        if hasattr(info, attr):
            try:
                return float(getattr(info, attr))
            except (TypeError, ValueError):
                return 0.0
    if isinstance(info, (int, float)):
        return float(info)
    return 0.0


def _get_analysis_safe(name: str) -> Optional[Dict[str, Any]]:
    try:
        analysis = get_analysis(name)
    except Exception:
        return None
    return analysis if isinstance(analysis, dict) else None


def _grade_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    def _loads(text: Any, default: Any) -> Any:
        try:
            val = json.loads(text)
        except (TypeError, ValueError):
            return default
        return val if isinstance(val, type(default)) else default

    return {
        "id": row["id"],
        "file": row["file"],
        "grader": row["grader"],
        "overall": row["overall"],
        "scores": _loads(row["scores"], {}),
        "tags": _loads(row["tags"], []),
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _latest_grades_and_counts() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
    """Latest grade per file (highest id) and total grade count per file."""
    with _db_lock:
        latest_rows = _db.execute(
            "SELECT g.* FROM grades g "
            "JOIN (SELECT file, MAX(id) AS mid FROM grades GROUP BY file) m "
            "ON g.id = m.mid"
        ).fetchall()
        count_rows = _db.execute(
            "SELECT file, COUNT(*) AS n FROM grades GROUP BY file"
        ).fetchall()
    latest = {r["file"]: _grade_from_row(r) for r in latest_rows}
    counts = {r["file"]: r["n"] for r in count_rows}
    return latest, counts


def _avg(values: List[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------------------------------------------------------------------------
# request models
# ---------------------------------------------------------------------------

class GradeIn(BaseModel):
    overall: int = Field(..., ge=1, le=5)
    scores: Dict[str, int] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    notes: str = Field("", max_length=4000)
    grader: str = Field("", max_length=80)

    @field_validator("scores")
    @classmethod
    def _validate_scores(cls, v: Dict[str, int]) -> Dict[str, int]:
        for key, val in v.items():
            if key not in GRADE_DIMS:
                raise ValueError(f"unknown score dimension: {key}")
            if not 1 <= val <= 5:
                raise ValueError(f"score '{key}' must be between 1 and 5")
        return v

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: List[str]) -> List[str]:
        if len(v) > 20:
            raise ValueError("at most 20 tags allowed")
        for tag in v:
            if len(tag) > 40:
                raise ValueError("each tag must be at most 40 characters")
        return v


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------

@router.get("/calls")
def list_calls() -> List[Dict[str, Any]]:
    latest, counts = _latest_grades_and_counts()
    items: List[Dict[str, Any]] = []
    for path in RECORDINGS_DIR.glob("*.wav"):
        name = path.name
        call_sid, _recording_sid, dt = _parse_name(name)
        if dt is None:
            dt = _mtime_utc(path)
        analysis = _get_analysis_safe(name)
        auto_eval = (analysis or {}).get("auto_eval") or {}
        try:
            size_bytes = path.stat().st_size
        except OSError:
            size_bytes = 0
        items.append(
            {
                "_sort": (dt, name),
                "file": name,
                "call_sid": call_sid,
                "recorded_at": dt.isoformat(),
                "duration_sec": _duration_sec(path),
                "size_bytes": size_bytes,
                "analyzed": analysis is not None,
                "outcome": (auto_eval.get("outcome") if analysis else None),
                "auto_scores": ((auto_eval.get("scores") or None) if analysis else None),
                "grade": latest.get(name),
                "grade_count": counts.get(name, 0),
            }
        )
    items.sort(key=lambda it: it["_sort"], reverse=True)  # newest first
    for it in items:
        it.pop("_sort", None)
    return items


@router.post("/calls/{file}/analyze")
def analyze_endpoint(file: str, force: bool = False, swap: bool = False) -> Dict[str, Any]:
    # plain def: FastAPI runs this in the threadpool (analysis is sync + slow).
    name = _safe_name(file)  # existence already checked -> later errors aren't 404s
    try:
        return analyze_call(name, force=force, swap_channels=swap)
    except ValueError as e:
        # The file exists but can't be analyzed (e.g. not 16-bit PCM).
        raise HTTPException(status_code=415, detail=str(e)[:300] or "unsupported audio format")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300] or "analysis failed")
    except httpx.HTTPError as e:
        # Transport-level STT/LLM failures (timeouts, connection errors).
        raise HTTPException(status_code=502, detail=f"STT/LLM transport error: {e}"[:300])
    except wave.Error as e:
        raise HTTPException(status_code=415, detail=f"corrupt WAV: {e}"[:300])


@router.get("/calls/{file}")
def get_call(file: str) -> Dict[str, Any]:
    name = _safe_name(file)
    with _db_lock:
        rows = _db.execute(
            "SELECT * FROM grades WHERE file = ? ORDER BY id DESC", (name,)
        ).fetchall()
    grades = [_grade_from_row(r) for r in rows]
    return {
        "file": name,
        "audio_url": f"/recordings/{name}",
        "analysis": _get_analysis_safe(name),
        "grade": grades[0] if grades else None,
        "grades": grades,
    }


@router.post("/calls/{file}/grade")
def grade_call(file: str, body: GradeIn) -> Dict[str, Any]:
    name = _safe_name(file)
    created_at = datetime.now(timezone.utc).isoformat()
    with _db_lock:
        cur = _db.execute(
            "INSERT INTO grades (file, grader, overall, scores, tags, notes, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                body.grader,
                body.overall,
                json.dumps(body.scores),
                json.dumps(body.tags),
                body.notes,
                created_at,
            ),
        )
        _db.commit()
        grade_id = cur.lastrowid
    return {
        "id": grade_id,
        "file": name,
        "grader": body.grader,
        "overall": body.overall,
        "scores": body.scores,
        "tags": body.tags,
        "notes": body.notes,
        "created_at": created_at,
    }


@router.get("/stats")
def stats() -> Dict[str, Any]:
    wav_paths = list(RECORDINGS_DIR.glob("*.wav"))
    analyses: List[Dict[str, Any]] = []
    for path in wav_paths:
        analysis = _get_analysis_safe(path.name)
        if analysis is not None:
            analyses.append(analysis)

    latest, _counts = _latest_grades_and_counts()

    overalls = [g["overall"] for g in latest.values() if _is_num(g.get("overall"))]

    human_by_dim: Dict[str, List[float]] = {}
    tag_counts: Dict[str, int] = {}
    for g in latest.values():
        scores = g.get("scores") or {}
        if isinstance(scores, dict):
            for dim, val in scores.items():
                if dim in GRADE_DIMS and _is_num(val):
                    human_by_dim.setdefault(dim, []).append(float(val))
        for tag in g.get("tags") or []:
            if isinstance(tag, str):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

    auto_by_dim: Dict[str, List[float]] = {}
    outcomes: Dict[str, int] = {}
    talk_ratios: List[float] = []
    latencies: List[float] = []
    diffs_by_dim: Dict[str, List[float]] = {dim: [] for dim in GRADE_DIMS}

    for analysis in analyses:
        auto_eval = analysis.get("auto_eval") or {}
        auto_scores = auto_eval.get("scores") or {}
        if isinstance(auto_scores, dict):
            for dim, val in auto_scores.items():
                if dim in GRADE_DIMS and _is_num(val):
                    auto_by_dim.setdefault(dim, []).append(float(val))
        outcome = auto_eval.get("outcome")
        if isinstance(outcome, str) and outcome:
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
        metrics = analysis.get("metrics") or {}
        if _is_num(metrics.get("talk_ratio_agent")):
            talk_ratios.append(float(metrics["talk_ratio_agent"]))
        if _is_num(metrics.get("avg_agent_response_latency_sec")):
            latencies.append(float(metrics["avg_agent_response_latency_sec"]))

        human = latest.get(analysis.get("file"))
        if human and isinstance(auto_scores, dict):
            human_scores = human.get("scores") or {}
            for dim in GRADE_DIMS:
                hv = human_scores.get(dim) if isinstance(human_scores, dict) else None
                av = auto_scores.get(dim)
                if _is_num(hv) and _is_num(av):
                    diffs_by_dim[dim].append(abs(float(hv) - float(av)))

    return {
        "calls": len(wav_paths),
        "analyzed": len(analyses),
        "graded": len(latest),
        "avg_overall": _avg([float(v) for v in overalls]),
        "human_avg_scores": {dim: _avg(vals) for dim, vals in human_by_dim.items()},
        "auto_avg_scores": {dim: _avg(vals) for dim, vals in auto_by_dim.items()},
        "outcomes": outcomes,
        "tag_counts": tag_counts,
        "avg_talk_ratio_agent": _avg(talk_ratios),
        "avg_response_latency_sec": _avg(latencies),
        "agreement": {dim: _avg(diffs) for dim, diffs in diffs_by_dim.items()},
    }
