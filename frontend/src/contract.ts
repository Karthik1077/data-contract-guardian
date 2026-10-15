// Helpers for reading, editing and writing the data contract JSON.
// The JSON text is always the source of truth; the visual builder edits it through these functions.

export type ColumnType = "string" | "integer" | "float" | "date" | "boolean";
export const COLUMN_TYPES: ColumnType[] = ["string", "integer", "float", "date", "boolean"];

export interface ColumnSpec {
  type?: ColumnType;
  required?: boolean;
  unique?: boolean;
  min?: number;
  max?: number;
  max_length?: number;
  allowed?: string[];
  pattern?: string;
}

export interface Contract {
  name?: string;
  min_rows?: number;
  columns: Record<string, ColumnSpec>;
}

export type ParseResult = { ok: true; contract: Contract } | { ok: false; error: string };

export function parseContract(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The JSON is not valid." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "The contract must be a JSON object." };
  }
  const obj = data as Record<string, unknown>;
  const cols = obj.columns;
  if (typeof cols !== "object" || cols === null || Array.isArray(cols) || Object.keys(cols).length === 0) {
    return { ok: false, error: 'The contract needs a non-empty "columns" object.' };
  }
  return { ok: true, contract: obj as unknown as Contract };
}

export function serializeContract(contract: Contract): string {
  return JSON.stringify(contract, null, 2);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0);
}

export function setColumn(contract: Contract, name: string, patch: Partial<ColumnSpec>): Contract {
  const spec: Record<string, unknown> = { ...contract.columns[name], ...patch };
  for (const key of Object.keys(spec)) {
    if (isEmpty(spec[key])) delete spec[key];
  }
  return { ...contract, columns: { ...contract.columns, [name]: spec as ColumnSpec } };
}

export function renameColumn(contract: Contract, from: string, to: string): Contract {
  const next = to.trim();
  if (!next || next === from || next in contract.columns) return contract;
  const columns: Record<string, ColumnSpec> = {};
  for (const [key, value] of Object.entries(contract.columns)) {
    columns[key === from ? next : key] = value;
  }
  return { ...contract, columns };
}

export function removeColumn(contract: Contract, name: string): Contract {
  const columns = { ...contract.columns };
  delete columns[name];
  return { ...contract, columns };
}

export function addColumn(contract: Contract): Contract {
  let n = Object.keys(contract.columns).length + 1;
  while (`column_${n}` in contract.columns) n += 1;
  return { ...contract, columns: { ...contract.columns, [`column_${n}`]: { type: "string" } } };
}

export function setMeta(contract: Contract, patch: { name?: string; min_rows?: number | undefined }): Contract {
  const next: Record<string, unknown> = { ...contract, ...patch };
  for (const key of ["name", "min_rows"]) {
    if (next[key] === undefined || next[key] === "") delete next[key];
  }
  return next as unknown as Contract;
}
