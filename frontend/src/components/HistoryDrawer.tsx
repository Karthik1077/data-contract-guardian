import { useEffect, useRef } from "react";
import type { Status, UploadRow } from "../types";
import { IconClose } from "./Icons";

interface Props {
  open: boolean;
  uploads: UploadRow[];
  activeId: number | null;
  onClose: () => void;
  onOpen: (id: number) => void;
}

const STATUS_TEXT: Record<Status, string> = {
  passed: "Passed",
  passed_with_warnings: "Warnings",
  failed: "Failed",
};

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

function Trend({ uploads }: { uploads: UploadRow[] }) {
  const points = uploads
    .slice(0, 20)
    .reverse()
    .map((u) => u.summary.clean_rate)
    .filter((r): r is number => r !== null);

  if (points.length < 2) {
    return <p className="muted">Run at least two checks to see your clean-rate trend.</p>;
  }

  const w = 360;
  const h = 70;
  const pad = 6;
  const step = (w - pad * 2) / (points.length - 1);
  const xy = points.map((p, i) => [pad + i * step, pad + (1 - p / 100) * (h - pad * 2)] as [number, number]);
  const path = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const average = Math.round(points.reduce((a, b) => a + b, 0) / points.length);
  const last = xy[xy.length - 1];

  return (
    <>
      <div className="trend-label">
        <span>Clean rate, last {points.length} checks</span>
        <strong>Average {average}%</strong>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Clean rate trend, average ${average} percent`}>
        <line className="base" x1={pad} x2={w - pad} y1={pad} y2={pad} />
        <path className="line" d={path} vectorEffect="non-scaling-stroke" />
        <circle className="dot" cx={last[0]} cy={last[1]} r="4" />
      </svg>
    </>
  );
}

export default function HistoryDrawer({ open, uploads, activeId, onClose, onOpen }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <>
      <div className={`overlay ${open ? "open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Check history" aria-hidden={!open}>
        <div className="drawer-head">
          <h2>History</h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close history">
            <IconClose size={17} />
          </button>
        </div>
        <div className="trend">
          <Trend uploads={uploads} />
        </div>
        {uploads.length === 0 ? (
          <p className="empty-state">Nothing here yet. Your checks from this browser will appear here.</p>
        ) : (
          <div className="history-list">
            {uploads.map((u) => (
              <button
                key={u.id}
                type="button"
                className={`history-item ${u.status} ${u.id === activeId ? "active" : ""}`}
                onClick={() => onOpen(u.id)}
              >
                <span className="sev-dot" aria-hidden="true" />
                <span style={{ minWidth: 0 }}>
                  <strong>{u.filename}</strong>
                  <small>
                    {STATUS_TEXT[u.status]}, {u.summary.error_count} errors, {u.summary.warning_count} warnings, {ago(u.created_at)}
                  </small>
                </span>
                <span className="history-rate">{u.summary.clean_rate === null ? "-" : `${u.summary.clean_rate}%`}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
