"""PostgreSQL access: tables are created automatically at startup.

We keep upload *history* (a summary per upload plus the grouped issues), not
the uploaded file itself. Each issue stores at most a handful of example
values, so a user's data is never stored in full.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
KEEP_LAST_UPLOADS = 500  # simple retention so a free database never fills up

SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  rule TEXT NOT NULL,
  column_name TEXT,
  affected_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  examples JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_uploads_client ON uploads (client_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_issues_upload ON issues (upload_id);
"""


@contextmanager
def get_conn() -> Iterator[Any]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    options: dict[str, Any] = {"connect_timeout": 10}
    local = "localhost" in DATABASE_URL or "127.0.0.1" in DATABASE_URL
    if not local and "sslmode" not in DATABASE_URL:
        options["sslmode"] = "require"  # hosted databases such as Supabase need SSL
    conn = psycopg2.connect(DATABASE_URL, **options)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA)


def is_healthy() -> bool:
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def save_upload(client_id: str, filename: str, contract_name: str, result: dict) -> dict:
    summary = result["summary"]
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """INSERT INTO uploads (client_id, filename, contract_name, status, summary)
               VALUES (%s, %s, %s, %s, %s) RETURNING id, created_at""",
            (client_id, filename, contract_name, summary["status"], psycopg2.extras.Json(summary)),
        )
        row = cur.fetchone()
        for issue in result["issues"]:
            cur.execute(
                """INSERT INTO issues
                   (upload_id, severity, rule, column_name, affected_count, message, suggestion, examples)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (row["id"], issue["severity"], issue["rule"], issue["column"], issue["affected_count"],
                 issue["message"], issue["suggestion"], psycopg2.extras.Json(issue["examples"])),
            )
        cur.execute(
            "DELETE FROM uploads WHERE id NOT IN (SELECT id FROM uploads ORDER BY id DESC LIMIT %s)",
            (KEEP_LAST_UPLOADS,),
        )
    return {"id": row["id"], "created_at": row["created_at"].isoformat()}


def list_uploads(client_id: str, limit: int) -> list[dict]:
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, filename, contract_name, status, summary, created_at
               FROM uploads WHERE client_id = %s ORDER BY id DESC LIMIT %s""",
            (client_id, limit),
        )
        rows = cur.fetchall()
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return rows


def get_upload(client_id: str, upload_id: int) -> dict | None:
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, filename, contract_name, summary, created_at
               FROM uploads WHERE id = %s AND client_id = %s""",
            (upload_id, client_id),
        )
        upload = cur.fetchone()
        if not upload:
            return None
        cur.execute(
            """SELECT severity, rule, column_name AS "column", affected_count, message, suggestion, examples
               FROM issues WHERE upload_id = %s ORDER BY id""",
            (upload_id,),
        )
        issues = cur.fetchall()
    return {
        "id": upload["id"],
        "filename": upload["filename"],
        "contract_name": upload["contract_name"],
        "created_at": upload["created_at"].isoformat(),
        "saved": True,
        "summary": upload["summary"],
        "issues": issues,
    }
