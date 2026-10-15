"""Data Contract Guardian API.

POST /api/validate            upload a CSV + a contract, get the validation result
GET  /api/uploads             history for this browser
GET  /api/uploads/{id}        one past result
GET  /api/uploads/{id}/report.csv   the issues as a downloadable CSV
GET  /api/health              is the API up, and can it reach the database?

There are no user accounts. Each browser sends a random X-Client-Id header and
only ever sees its own history. That is privacy-by-separation, not security:
anyone who knew your id could read your history, which is why uploads store
only a few example values and never the whole file.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from . import db
from .validator import ContractError, CsvError, load_csv, validate, validate_contract

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("guardian")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB keeps us inside free-tier memory limits
CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        db.init_db()
        logger.info("Database ready.")
    except Exception as exc:  # the API still starts so /api/health can explain what is wrong
        logger.error("Database is not ready: %s", exc)
    yield


app = FastAPI(title="Data Contract Guardian", version="1.0.0", lifespan=lifespan)

allowed_origins = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _require_client_id(value: str | None) -> str:
    if not value or not CLIENT_ID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail="Missing or invalid X-Client-Id header.")
    return value


@app.get("/")
def root() -> dict:
    return {"name": "Data Contract Guardian API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": db.is_healthy()}


def _process(client_id: str, filename: str, content: bytes, contract_text: str) -> dict:
    """Blocking work (pandas + database). Runs in a worker thread, off the event loop."""
    try:
        contract = json.loads(contract_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"The contract is not valid JSON (line {exc.lineno}, column {exc.colno}): {exc.msg}.",
        )
    try:
        validate_contract(contract)
        df = load_csv(content)
    except (ContractError, CsvError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = validate(df, contract)
    payload = {
        "id": None,
        "filename": filename[:200],
        "contract_name": str(contract.get("name", "unnamed contract"))[:100],
        "created_at": None,
        "saved": False,
        **result,
    }
    try:
        saved = db.save_upload(client_id, payload["filename"], payload["contract_name"], result)
        payload.update(id=saved["id"], created_at=saved["created_at"], saved=True)
    except Exception as exc:  # the user still gets their result even if history can't be saved
        logger.error("Could not save upload: %s", exc)
    return payload


@app.post("/api/validate")
async def validate_upload(
    file: UploadFile = File(...),
    contract: str = Form(...),
    x_client_id: str | None = Header(default=None),
) -> dict:
    client_id = _require_client_id(x_client_id)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 5 MB. Try a smaller sample of it.")
    return await run_in_threadpool(_process, client_id, file.filename or "upload.csv", content, contract)


def _db_call(func, *args):
    try:
        return func(*args)
    except Exception as exc:
        logger.error("Database error: %s", exc)
        raise HTTPException(status_code=503, detail="The database is not reachable right now. Please try again.")


@app.get("/api/uploads")
def list_uploads(limit: int = 20, x_client_id: str | None = Header(default=None)) -> dict:
    client_id = _require_client_id(x_client_id)
    return {"uploads": _db_call(db.list_uploads, client_id, max(1, min(limit, 100)))}


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: int, x_client_id: str | None = Header(default=None)) -> dict:
    client_id = _require_client_id(x_client_id)
    upload = _db_call(db.get_upload, client_id, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return upload


def _safe_cell(value) -> str:
    """Stop spreadsheet formula injection: a cell starting with = + - @ would run as a formula in Excel."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@app.get("/api/uploads/{upload_id}/report.csv")
def download_report(upload_id: int, x_client_id: str | None = Header(default=None)) -> Response:
    client_id = _require_client_id(x_client_id)
    upload = _db_call(db.get_upload, client_id, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found.")

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["severity", "rule", "column", "rows_affected", "what_went_wrong", "how_to_fix", "examples"])
    for issue in upload["issues"]:
        examples = "; ".join(f"line {e['row']}: {e['value']}" if e["value"] is not None else f"line {e['row']}"
                             for e in issue["examples"])
        writer.writerow([
            _safe_cell(issue["severity"]), _safe_cell(issue["rule"]), _safe_cell(issue["column"]),
            issue["affected_count"], _safe_cell(issue["message"]), _safe_cell(issue["suggestion"]),
            _safe_cell(examples),
        ])
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="report-{upload_id}.csv"'},
    )
