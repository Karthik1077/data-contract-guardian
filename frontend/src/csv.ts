// Small, dependency-free CSV tools that run in the browser:
//  - parseCsv:      reads a file into rows and remembers the true line number of every record
//  - inferContract: looks at the data and proposes a starter contract
// The server stays the source of truth for validation; this only powers previews and suggestions.
import type { ColumnSpec, ColumnType, Contract } from "./contract";

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  lines: number[]; // spreadsheet line number of each row (the header is line 1)
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  const starts: number[] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStart = 1;

  const endRecord = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0].trim() === "")) {
      records.push(row);
      starts.push(recordStart);
    }
    row = [];
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      endRecord();
      line += 1;
      recordStart = line;
    } else if (ch !== "\r") {
      field += ch;
    }
    i += 1;
  }
  if (field !== "" || row.length > 0) endRecord();

  const header = (records[0] ?? []).map((h) => h.trim());
  const width = header.length;
  const rows = records.slice(1).map((r) => {
    const padded = r.slice(0, Math.max(width, r.length));
    while (padded.length < width) padded.push("");
    return padded;
  });
  return { header, rows, lines: starts.slice(1) };
}

const NULL_TOKENS = new Set(["", "null", "none", "nan", "n/a", "na"]);
const BOOLEAN_TOKENS = new Set(["true", "false", "yes", "no", "t", "f", "y", "n"]);

function isNull(value: string): boolean {
  return NULL_TOKENS.has(value.trim().toLowerCase());
}

function detectType(values: string[]): ColumnType {
  if (values.length === 0) return "string";
  if (values.every((v) => /^-?\d+$/.test(v))) return "integer";
  if (values.every((v) => /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v))) return "float";
  if (values.every((v) => BOOLEAN_TOKENS.has(v.toLowerCase()))) return "boolean";
  if (values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) return "date";
  return "string";
}

export function detectColumnTypes(parsed: ParsedCsv): ColumnType[] {
  return parsed.header.map((_, idx) => {
    const values = parsed.rows.map((r) => (r[idx] ?? "").trim()).filter((v) => !isNull(v));
    return detectType(values);
  });
}

export function inferContract(fileName: string, parsed: ParsedCsv): Contract {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const columns: Record<string, ColumnSpec> = {};

  parsed.header.forEach((name, idx) => {
    if (!name || name in columns) return;
    const all = parsed.rows.map((r) => (r[idx] ?? "").trim());
    const present = all.filter((v) => !isNull(v));
    const type = detectType(present);
    const spec: ColumnSpec = { type };

    if (all.length > 0 && present.length === all.length) spec.required = true;

    const idLike = /(^|_)(id|uuid|key)$/i.test(name);
    if (idLike && present.length > 1 && present.length === all.length && new Set(present).size === present.length) {
      spec.unique = true;
    }
    if ((type === "integer" || type === "float") && present.length > 0 && present.every((v) => Number(v) >= 0)) {
      spec.min = 0;
    }
    if (type === "string") {
      const distinct = Array.from(new Set(present));
      if (/email/i.test(name)) {
        spec.pattern = "[^@\\s]+@[^@\\s]+\\.[^@\\s]+";
      } else if (present.length >= 5 && distinct.length <= 6 && distinct.length * 2 <= present.length) {
        spec.allowed = distinct.sort();
      }
    }
    columns[name] = spec;
  });

  return { name: `${base || "my_file"}_v1`, min_rows: 1, columns };
}
