export type Severity = "error" | "warning";
export type Status = "passed" | "passed_with_warnings" | "failed";

export interface Example {
  row: number;
  value: string | null;
}

export interface Issue {
  severity: Severity;
  rule: string;
  column: string | null;
  affected_count: number;
  message: string;
  suggestion: string;
  examples: Example[];
}

export interface Summary {
  row_count: number;
  column_count: number;
  error_count: number;
  warning_count: number;
  rows_with_errors: number;
  clean_rate: number | null;
  status: Status;
}

export interface ValidationResult {
  id: number | null;
  filename: string;
  contract_name: string;
  created_at: string | null;
  saved: boolean;
  summary: Summary;
  issues: Issue[];
}

export interface UploadRow {
  id: number;
  filename: string;
  contract_name: string;
  status: Status;
  summary: Summary;
  created_at: string;
}
