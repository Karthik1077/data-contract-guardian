import { useEffect, useState } from "react";
import type { Status } from "../types";

interface Props {
  rate: number | null;
  status: Status;
}

const RADIUS = 66;
const CIRC = 2 * Math.PI * RADIUS;
const TICKS = 60;

export default function ScoreSeal({ rate, status }: Props) {
  const target = rate ?? 0;
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
    const inner = 74;
    const outer = i % 5 === 0 ? 81 : 78;
    return {
      key: i,
      x1: 90 + Math.cos(angle) * inner,
      y1: 90 + Math.sin(angle) * inner,
      x2: 90 + Math.cos(angle) * outer,
      y2: 90 + Math.sin(angle) * outer,
      on: rate !== null && (i / TICKS) * 100 < value,
    };
  });

  return (
    <div
      className={`seal ${status}`}
      role="img"
      aria-label={rate === null ? "No rows to score" : `${rate} percent of rows are clean`}
    >
      <svg viewBox="0 0 180 180">
        {ticks.map((t) => (
          <line key={t.key} className={`tick ${t.on ? "on" : ""}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
        ))}
        <circle className="track" cx="90" cy="90" r={RADIUS} fill="none" strokeWidth="9" />
        <circle
          className="arc"
          cx="90"
          cy="90"
          r={RADIUS}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - value / 100)}
          transform="rotate(-90 90 90)"
        />
      </svg>
      <div className="seal-center">
        {rate === null ? (
          <>
            <strong>-</strong>
            <span>no rows</span>
          </>
        ) : (
          <>
            <strong>
              {Math.round(value)}
              <small>%</small>
            </strong>
            <span>clean rows</span>
          </>
        )}
      </div>
    </div>
  );
}
