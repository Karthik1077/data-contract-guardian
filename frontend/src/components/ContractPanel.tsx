import { useEffect, useMemo, useState } from "react";
import {
  COLUMN_TYPES,
  addColumn,
  parseContract,
  removeColumn,
  renameColumn,
  setColumn,
  setMeta,
  serializeContract,
} from "../contract";
import type { ColumnSpec, ColumnType, Contract } from "../contract";
import { SAMPLE_CONTRACT } from "../sample";
import { IconChevron, IconPlus, IconTrash } from "./Icons";

interface Props {
  contractText: string;
  onChange: (value: string) => void;
}

interface RowProps {
  name: string;
  spec: ColumnSpec;
  open: boolean;
  contract: Contract;
  onToggle: () => void;
  onChange: (next: Contract) => void;
}

function extraSummary(spec: ColumnSpec): string[] {
  const out: string[] = [];
  if (spec.min !== undefined) out.push(`min ${spec.min}`);
  if (spec.max !== undefined) out.push(`max ${spec.max}`);
  if (spec.max_length !== undefined) out.push(`max length ${spec.max_length}`);
  if (spec.allowed && spec.allowed.length > 0) out.push(`${spec.allowed.length} allowed values`);
  if (spec.pattern) out.push("pattern");
  return out;
}

function toNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function ColumnRow({ name, spec, open, contract, onToggle, onChange }: RowProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftAllowed, setDraftAllowed] = useState((spec.allowed ?? []).join(", "));

  useEffect(() => setDraftName(name), [name]);
  useEffect(() => setDraftAllowed((spec.allowed ?? []).join(", ")), [spec.allowed]);

  const type: ColumnType = spec.type ?? "string";
  const numeric = type === "integer" || type === "float";
  const extras = extraSummary(spec);

  const patch = (change: Partial<ColumnSpec>) => onChange(setColumn(contract, name, change));

  const commitName = () => {
    const next = renameColumn(contract, name, draftName);
    if (next === contract) setDraftName(name);
    else onChange(next);
  };

  const commitAllowed = () => {
    const list = draftAllowed
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    patch({ allowed: list });
  };

  return (
    <li className={`col-row ${open ? "open" : ""}`}>
      <div className="col-main">
        <input
          className="name-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label={`Name of column ${name}`}
        />
        <select value={type} onChange={(e) => patch({ type: e.target.value as ColumnType })} aria-label={`Type of ${name}`}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={Boolean(spec.required)} onChange={(e) => patch({ required: e.target.checked })} />
          Required
        </label>
        <label className="toggle">
          <input type="checkbox" checked={Boolean(spec.unique)} onChange={(e) => patch({ unique: e.target.checked })} />
          Unique
        </label>
        <button
          type="button"
          className="tiny-btn"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Hide more rules for ${name}` : `More rules for ${name}`}
        >
          <IconChevron size={16} className="chev" />
        </button>
      </div>

      {!open && extras.length > 0 && (
        <div className="extras">
          {extras.map((e) => (
            <span key={e} className="extra-chip">
              {e}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="more">
          {numeric && (
            <>
              <label className="field">
                <span>Minimum</span>
                <input type="number" value={spec.min ?? ""} onChange={(e) => patch({ min: toNumber(e.target.value) })} />
              </label>
              <label className="field">
                <span>Maximum</span>
                <input type="number" value={spec.max ?? ""} onChange={(e) => patch({ max: toNumber(e.target.value) })} />
              </label>
            </>
          )}
          <label className="field">
            <span>Longest allowed text</span>
            <input
              type="number"
              min={1}
              value={spec.max_length ?? ""}
              onChange={(e) => patch({ max_length: toNumber(e.target.value) })}
            />
          </label>
          <label className="field wide">
            <span>Allowed values, separated by commas</span>
            <input
              type="text"
              value={draftAllowed}
              placeholder="active, inactive, pending"
              onChange={(e) => setDraftAllowed(e.target.value)}
              onBlur={commitAllowed}
            />
          </label>
          <label className="field wide">
            <span>Pattern (regular expression the whole value must match)</span>
            <input
              type="text"
              value={spec.pattern ?? ""}
              placeholder="[^@\s]+@[^@\s]+\.[^@\s]+"
              onChange={(e) => patch({ pattern: e.target.value })}
            />
          </label>
          <div className="more-actions">
            <button
              type="button"
              className="danger"
              onClick={() => onChange(removeColumn(contract, name))}
            >
              <IconTrash size={15} />
              Remove column
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Builder({ contract, onChange }: { contract: Contract; onChange: (next: Contract) => void }) {
  const [openName, setOpenName] = useState<string | null>(null);
  const names = Object.keys(contract.columns);

  return (
    <div className="builder">
      <div className="meta-row">
        <label className="field">
          <span>Contract name</span>
          <input
            type="text"
            value={contract.name ?? ""}
            placeholder="customers_v1"
            onChange={(e) => onChange(setMeta(contract, { name: e.target.value }))}
          />
        </label>
        <label className="field narrow">
          <span>Minimum rows</span>
          <input
            type="number"
            min={0}
            value={contract.min_rows ?? ""}
            onChange={(e) => {
              const n = toNumber(e.target.value);
              onChange(setMeta(contract, { min_rows: n === undefined ? undefined : Math.max(0, Math.floor(n)) }));
            }}
          />
        </label>
      </div>

      <ul className="cols">
        {names.map((name) => (
          <ColumnRow
            key={name}
            name={name}
            spec={contract.columns[name]}
            open={openName === name}
            contract={contract}
            onToggle={() => setOpenName(openName === name ? null : name)}
            onChange={onChange}
          />
        ))}
      </ul>

      <button type="button" className="ghost add" onClick={() => onChange(addColumn(contract))}>
        <IconPlus size={15} />
        Add column
      </button>
    </div>
  );
}

export default function ContractPanel({ contractText, onChange }: Props) {
  const [mode, setMode] = useState<"builder" | "json">("builder");
  const parsed = useMemo(() => parseContract(contractText), [contractText]);
  const columnCount = parsed.ok ? Object.keys(parsed.contract.columns).length : 0;

  return (
    <section className="pane" aria-labelledby="step-contract">
      <div className="pane-head">
        <div className="step">
          <span className="step-num">1</span>
          <h2 id="step-contract">Describe a valid file</h2>
        </div>
        <div className="seg" role="group" aria-label="Contract editor mode">
          <button type="button" aria-pressed={mode === "builder"} onClick={() => setMode("builder")}>
            Builder
          </button>
          <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>
            JSON
          </button>
        </div>
      </div>
      <p className="hint">
        The contract lists each column and the rules its values must follow. Use the builder, or edit the JSON directly.{" "}
        <button type="button" className="link-btn" onClick={() => onChange(SAMPLE_CONTRACT)}>
          Reset to the sample contract
        </button>
      </p>

      {mode === "json" ? (
        <>
          <textarea
            className="code-box"
            value={contractText}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-label="Data contract as JSON"
          />
          <p className={`status-line ${parsed.ok ? "ok" : "bad"}`}>
            {parsed.ok ? `Valid JSON with ${columnCount} column${columnCount === 1 ? "" : "s"}` : parsed.error}
          </p>
        </>
      ) : parsed.ok ? (
        <Builder contract={parsed.contract} onChange={(next) => onChange(serializeContract(next))} />
      ) : (
        <div className="notice-box">
          <span>The builder needs valid JSON. Problem found: {parsed.error}</span>
          <button type="button" className="ghost" onClick={() => setMode("json")}>
            Fix it in the JSON tab
          </button>
        </div>
      )}
    </section>
  );
}
