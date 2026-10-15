import { useMemo, useState } from "react";
import type { ParsedCsv } from "../csv";
import type { Issue, Severity, Status, ValidationResult } from "../types";
import { IconChevron, IconCopy, IconDownload, IconLayers, IconSearch } from "./Icons";
import ScoreSeal from "./ScoreSeal";

export const RULE_LABELS: Record<string, string> = {
  missing_column: "Missing column",
  missing_value: "Missing value",
  wrong_type: "Wrong type",
  below_min: "Below minimum",
  above_max: "Above maximum",
  not_allowed: "Not allowed",
  pattern_mismatch: "Bad format",
  too_long: "Too long",
  duplicate_value: "Duplicate value",
  too_few_rows: "Too few rows",
  unexpected_columns: "Extra columns",
  duplicate_rows: "Duplicate rows",
  high_null_rate: "Many blanks",
};

const VERDICTS: Record<Status, { title: string; blurb: string }> = {
  passed: { title: "Passed", blurb: "Every row meets the contract." },
  passed_with_warnings: { title: "Passed with warnings", blurb: "The file meets the contract, but a few things deserve a look." },
  failed: { title: "Failed", blurb: "The file breaks the contract. Fix the errors below and check again." },
};

type Filter = "all" | "error" | "warning";
interface Item {
  issue: Issue;
  index: number;
}

function scopeOf(issue: Issue): string {
  if (issue.affected_count > 0) return `${issue.affected_count} row${issue.affected_count === 1 ? "" : "s"}`;
  return issue.column ? "whole column" : "whole file";
}

function IssueRow({ issue, open, onToggle }: { issue: Issue; open: boolean; onToggle: () => void }) {
  return (
    <li className={`issue ${issue.severity} ${open ? "open" : ""}`}>
      <button type="button" className="issue-head" aria-expanded={open} onClick={onToggle}>
        <span className="sev-dot" aria-hidden="true" />
        <span>
          <span className="issue-title">{issue.message}</span>
          <span className="issue-meta">
            <span className="chip sev">{issue.severity === "error" ? "Error" : "Warning"}</span>
            <span className="chip rule">{RULE_LABELS[issue.rule] ?? issue.rule}</span>
            {issue.column && <code>{issue.column}</code>}
            <span>{scopeOf(issue)}</span>
          </span>
        </span>
        <IconChevron size={18} className="chev" />
      </button>
      {open && (
        <div className="issue-body">
          <div className="fix">
            <span className="fix-label">How to fix</span>
            {issue.suggestion}
          </div>
          {issue.examples.length > 0 && (
            <div>
              <table className="examples">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {issue.examples.map((ex, i) => (
                    <tr key={`${ex.row}-${i}`}>
                      <td>{ex.row}</td>
                      <td>
                        {ex.value === null ? "-" : ex.value === "" ? <span className="empty-cell">(empty)</span> : <code>{ex.value}</code>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {issue.affected_count > issue.examples.length && (
                <p className="more-note">
                  Showing the first {issue.examples.length} of {issue.affected_count}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function FlaggedRows({ parsed, issues }: { parsed: ParsedCsv; issues: Issue[] }) {
  const { rows, total } = useMemo(() => {
    const flagged = new Map<number, { cols: Set<string>; severity: Severity }>();
    for (const issue of issues) {
      for (const ex of issue.examples) {
        const entry = flagged.get(ex.row) ?? { cols: new Set<string>(), severity: issue.severity };
        if (issue.column) entry.cols.add(issue.column);
        if (issue.severity === "error") entry.severity = "error";
        flagged.set(ex.row, entry);
      }
    }
    const lineToIndex = new Map<number, number>(parsed.lines.map((line, i) => [line, i] as [number, number]));
    const all = Array.from(flagged.entries())
      .map(([line, info]) => ({ line, info, idx: lineToIndex.get(line) }))
      .filter((r): r is { line: number; info: { cols: Set<string>; severity: Severity }; idx: number } => r.idx !== undefined)
      .sort((a, b) => a.line - b.line);
    return { rows: all.slice(0, 15), total: all.length };
  }, [parsed, issues]);

  if (rows.length === 0) return null;

  return (
    <section className="surface flagged" aria-labelledby="flagged-title">
      <h3 id="flagged-title">Where the problems are</h3>
      <p>These rows from your file triggered the issues above. Highlighted cells are the ones to fix.</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Line</th>
              {parsed.header.map((h, i) => (
                <th key={`${h}-${i}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, info, idx }) => (
              <tr key={line} className={info.cols.size === 0 ? "row-flag" : ""}>
                <td className="line">{line}</td>
                {parsed.header.map((h, c) => {
                  const bad = info.cols.has(h);
                  const value = parsed.rows[idx][c] ?? "";
                  return (
                    <td key={`${h}-${c}`} className={bad ? `bad ${info.severity === "warning" ? "warn" : ""}` : ""}>
                      {value === "" ? <span className="empty-cell">(empty)</span> : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && <p className="foot-note">Showing {rows.length} of {total} flagged rows. The CSV report lists the rest.</p>}
    </section>
  );
}

function summaryText(result: ValidationResult): string {
  const s = result.summary;
  const lines = [
    `${result.filename} checked against ${result.contract_name}: ${VERDICTS[s.status].title}`,
    `${s.row_count} rows, ${s.error_count} errors, ${s.warning_count} warnings, ${s.clean_rate === null ? "no" : `${s.clean_rate}%`} clean rows`,
  ];
  for (const issue of result.issues) {
    lines.push(`- [${issue.severity}] ${issue.message} Fix: ${issue.suggestion}`);
  }
  return lines.join("\n");
}

function downloadJson(result: ValidationResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `report-${result.id ?? "latest"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  result: ValidationResult;
  delta: number | null;
  parsed: ParsedCsv | null;
  onDownload: () => void;
  onToast: (text: string) => void;
}

export default function ResultView({ result, delta, parsed, onDownload, onToast }: Props) {
  const { summary, issues } = result;
  const verdict = VERDICTS[summary.status];
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set(issues.length > 0 ? [0] : []));

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => filter === "all" || issue.severity === filter)
      .filter(({ issue }) => {
        if (!q) return true;
        const hay = `${issue.message} ${issue.column ?? ""} ${RULE_LABELS[issue.rule] ?? issue.rule}`.toLowerCase();
        return hay.includes(q);
      });
  }, [issues, filter, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const key = item.issue.column ?? "Whole file";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [items]);

  const toggle = (index: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const allOpen = items.length > 0 && items.every((i) => open.has(i.index));

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText(result));
      onToast("Summary copied to your clipboard.");
    } catch {
      onToast("Your browser blocked copying. Use the JSON download instead.");
    }
  }

  const deltaText =
    delta === null
      ? null
      : delta === 0
        ? "Same clean rate as your last check of this contract."
        : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} point${Math.abs(delta) === 1 ? "" : "s"} from your last check of this contract.`;

  return (
    <section className="results" aria-live="polite" aria-label="Validation results">
      <div className="surface verdict-row">
        <ScoreSeal rate={summary.clean_rate} status={summary.status} />
        <div className="verdict-text">
          <h2 className={`verdict-title ${summary.status}`}>{verdict.title}</h2>
          <p>{verdict.blurb}</p>
          <p>
            <code>{result.filename}</code> checked against <code>{result.contract_name}</code>
          </p>
          {deltaText && <p className={`delta ${delta !== null && delta >= 0 ? "up" : "down"}`}>{deltaText}</p>}
          <div className="result-actions">
            {result.id !== null && (
              <button type="button" className="ghost" onClick={onDownload}>
                <IconDownload size={15} />
                CSV report
              </button>
            )}
            <button type="button" className="ghost" onClick={() => downloadJson(result)}>
              <IconDownload size={15} />
              JSON report
            </button>
            <button type="button" className="ghost" onClick={copySummary}>
              <IconCopy size={15} />
              Copy summary
            </button>
          </div>
        </div>
        <dl className="stats">
          <div>
            <dt>Rows checked</dt>
            <dd>{summary.row_count}</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd>{summary.column_count}</dd>
          </div>
          <div>
            <dt>Rows with errors</dt>
            <dd>{summary.rows_with_errors}</dd>
          </div>
          <div>
            <dt>Issues found</dt>
            <dd>
              {issues.length}
              <small>
                {errorCount} errors, {warningCount} warnings
              </small>
            </dd>
          </div>
        </dl>
      </div>

      {!result.saved && <p className="notice">This result could not be saved to history, but it is shown in full below.</p>}

      {issues.length > 0 ? (
        <>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Filter issues">
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All {issues.length}
              </button>
              <button type="button" aria-pressed={filter === "error"} onClick={() => setFilter("error")}>
                Errors {errorCount}
              </button>
              <button type="button" aria-pressed={filter === "warning"} onClick={() => setFilter("warning")}>
                Warnings {warningCount}
              </button>
            </div>
            <label className="search">
              <IconSearch size={15} />
              <span className="sr-only">Search issues</span>
              <input type="text" placeholder="Search issues" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <span className="spacer" />
            <button type="button" className="ghost" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
              <IconLayers size={15} />
              {grouped ? "Ungroup" : "Group by column"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setOpen(allOpen ? new Set() : new Set(items.map((i) => i.index)))}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div className="surface issues">
            {items.length === 0 ? (
              <p className="empty-state">No issues match your filter.</p>
            ) : grouped ? (
              groups.map(([name, group]) => (
                <div key={name}>
                  <h4 className="group-head">
                    {name}
                    <span>
                      {group.length} issue{group.length === 1 ? "" : "s"}
                    </span>
                  </h4>
                  <ul>
                    {group.map(({ issue, index }) => (
                      <IssueRow key={index} issue={issue} open={open.has(index)} onToggle={() => toggle(index)} />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <ul>
                {items.map(({ issue, index }) => (
                  <IssueRow key={index} issue={issue} open={open.has(index)} onToggle={() => toggle(index)} />
                ))}
              </ul>
            )}
          </div>

          {parsed && <FlaggedRows parsed={parsed} issues={issues} />}
        </>
      ) : (
        <p className="surface empty-state" style={{ marginTop: "1.2rem" }}>
          No problems found. This file is ready to load.
        </p>
      )}
    </section>
  );
}
