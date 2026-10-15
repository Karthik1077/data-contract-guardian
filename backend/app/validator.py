"""Validation engine: checks a CSV file against a *data contract*.

A data contract is a small JSON document that says what a file is allowed to
look like: which columns must exist, what type each column holds, which values
are allowed, which values must be unique, and so on.

Flow:  validate_contract()  ->  load_csv()  ->  validate()

Everything is read as text first (dtype=str) so that *we* decide what counts
as a valid number or date, instead of letting pandas silently guess.
"""
from __future__ import annotations

import csv
import difflib
import io
import re
import warnings
from typing import Any

import pandas as pd

# Values that count as "empty", compared case-insensitively after trimming.
NULL_TOKENS = {"", "null", "none", "nan", "n/a", "na"}
BOOLEAN_TOKENS = {"true", "false", "yes", "no", "t", "f", "y", "n", "0", "1"}
VALID_TYPES = {"string", "integer", "float", "date", "boolean"}
NUMERIC_TYPES = {"integer", "float"}

MAX_EXAMPLES = 5          # example rows kept per issue
MAX_VALUE_CHARS = 80      # long cell values are shortened in examples
HIGH_NULL_RATE = 0.30     # warn when more than 30% of an optional column is empty


class ContractError(ValueError):
    """The contract itself is not valid."""


class CsvError(ValueError):
    """The uploaded file could not be read as a CSV."""


# --------------------------------------------------------------------------
# 1. Check the contract
# --------------------------------------------------------------------------
def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_contract(contract: Any) -> None:
    """Raise ContractError with a friendly message if the contract is malformed."""
    if not isinstance(contract, dict):
        raise ContractError('The contract must be a JSON object, like {"columns": {...}}.')

    columns = contract.get("columns")
    if not isinstance(columns, dict) or not columns:
        raise ContractError('The contract needs a non-empty "columns" object.')

    min_rows = contract.get("min_rows", 1)
    if isinstance(min_rows, bool) or not isinstance(min_rows, int) or min_rows < 0:
        raise ContractError('"min_rows" must be a whole number, 0 or higher.')

    for name, spec in columns.items():
        if not isinstance(spec, dict):
            raise ContractError(f'Column "{name}": the rules must be an object, for example {{"type": "string"}}.')

        ctype = spec.get("type", "string")
        if ctype not in VALID_TYPES:
            raise ContractError(
                f'Column "{name}": unknown type "{ctype}". Use one of: {", ".join(sorted(VALID_TYPES))}.'
            )

        for flag in ("required", "unique"):
            if flag in spec and not isinstance(spec[flag], bool):
                raise ContractError(f'Column "{name}": "{flag}" must be true or false.')

        for bound in ("min", "max"):
            if bound in spec:
                if ctype not in NUMERIC_TYPES:
                    raise ContractError(f'Column "{name}": "{bound}" only works with integer or float columns.')
                if not _is_number(spec[bound]):
                    raise ContractError(f'Column "{name}": "{bound}" must be a number.')

        if "max_length" in spec:
            value = spec["max_length"]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ContractError(f'Column "{name}": "max_length" must be a whole number, 0 or higher.')

        if "allowed" in spec:
            if not isinstance(spec["allowed"], list) or not spec["allowed"]:
                raise ContractError(f'Column "{name}": "allowed" must be a non-empty list.')

        if "pattern" in spec:
            if not isinstance(spec["pattern"], str):
                raise ContractError(f'Column "{name}": "pattern" must be text.')
            try:
                re.compile(spec["pattern"])
            except re.error as exc:
                raise ContractError(f'Column "{name}": "pattern" is not a valid regular expression ({exc}).')


# --------------------------------------------------------------------------
# 2. Read the CSV
# --------------------------------------------------------------------------
def load_csv(content: bytes) -> pd.DataFrame:
    """Read uploaded bytes into a DataFrame where every cell is text."""
    if not content.strip():
        raise CsvError("The file is empty.")

    try:
        text = content.decode("utf-8-sig")  # utf-8-sig also strips the Excel BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    header = text.splitlines()[0] if text.splitlines() else ""
    if "," not in header and (";" in header or "\t" in header):
        raise CsvError(
            "This file looks like it uses semicolons or tabs between columns. "
            "Please save it as a comma-separated CSV and upload it again."
        )

    # We read the file with Python's csv module (not pd.read_csv) for two reasons:
    #  1. pandas silently shifts columns when a row has too many values;
    #  2. we need the *true* line number of every record, so that "row 17" in
    #     a report matches line 17 in the user's spreadsheet, even with blank
    #     lines or multi-line cells in the file.
    try:
        reader = csv.reader(io.StringIO(text, newline=""))
        header = [h.strip() for h in (next(reader, None) or [])]
        if not any(header):
            raise CsvError("The file has no header row.")
        duplicates = sorted({h for h in header if header.count(h) > 1})
        if duplicates:
            raise CsvError(f'The header repeats the column name "{duplicates[0]}". Column names must be unique.')

        width = len(header)
        rows: list[list[str]] = []
        line_numbers: list[int] = []
        previous_end = reader.line_num
        for record in reader:
            start_line = previous_end + 1
            previous_end = reader.line_num
            if not record:  # a completely blank line
                continue
            if len(record) > width:
                raise CsvError(
                    f"Line {start_line} has {len(record)} values but the header only has {width} columns. "
                    "A value that contains a comma needs to be wrapped in double quotes."
                )
            rows.append(record + [""] * (width - len(record)))  # short rows are padded with empty text
            line_numbers.append(start_line)
    except csv.Error as exc:
        raise CsvError(f"The file is not a well-formed CSV: {exc}")

    df = pd.DataFrame(rows, columns=header, dtype=str)
    df.attrs["line_numbers"] = line_numbers
    return df


# --------------------------------------------------------------------------
# 3. Run the checks
# --------------------------------------------------------------------------
def _count(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _clip(value: Any) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= MAX_VALUE_CHARS else text[:MAX_VALUE_CHARS] + "..."


def _null_mask(series: pd.Series) -> pd.Series:
    return series.str.strip().str.lower().isin(NULL_TOKENS)


class _Collector:
    """Gathers issues. Row numbers are shown as spreadsheet lines (header = line 1)."""

    def __init__(self, line_numbers: list[int] | None = None) -> None:
        self.issues: list[dict] = []
        self.error_rows: set[int] = set()
        self.line_numbers = line_numbers

    def line_of(self, position: int) -> int:
        if self.line_numbers and position < len(self.line_numbers):
            return self.line_numbers[position]
        return int(position) + 2

    def add(self, severity: str, rule: str, column: str | None, message: str,
            suggestion: str, positions: list[int] | None = None,
            values: pd.Series | None = None) -> None:
        positions = positions or []
        examples = [
            {"row": self.line_of(int(p)), "value": _clip(values.loc[p]) if values is not None else None}
            for p in positions[:MAX_EXAMPLES]
        ]
        if severity == "error":
            self.error_rows.update(int(p) for p in positions)
        self.issues.append({
            "severity": severity,
            "rule": rule,
            "column": column,
            "affected_count": len(positions),
            "message": message,
            "suggestion": suggestion,
            "examples": examples,
        })


TYPE_LABEL = {"integer": "whole number", "float": "number", "date": "date", "boolean": "true/false value"}
TYPE_FIX = {
    "integer": "Use digits only, with no decimals, commas or text (for example 42).",
    "float": "Use digits with a dot for decimals (for example 12.50), without currency symbols or thousands separators.",
    "date": "Use one consistent date format such as 2025-01-31 (year-month-day), and check for impossible dates.",
    "boolean": "Use true/false, yes/no or 1/0.",
}


def _positions(mask: pd.Series) -> list[int]:
    return mask[mask].index.tolist()


def _check_column(c: _Collector, name: str, spec: dict, series: pd.Series, total_rows: int) -> None:
    required = spec.get("required", False)
    ctype = spec.get("type", "string")

    # --- empty values -----------------------------------------------------
    null_mask = _null_mask(series)
    if null_mask.any():
        if required:
            c.add("error", "missing_value", name,
                  f'Required column "{name}" is empty in {_count(int(null_mask.sum()), "row")}.',
                  "Fill in the missing values, or mark the column as not required in the contract if blanks are acceptable.",
                  _positions(null_mask), series)
        elif total_rows and null_mask.mean() > HIGH_NULL_RATE:
            pct = round(100 * float(null_mask.mean()))
            c.add("warning", "high_null_rate", name,
                  f'{pct}% of the values in "{name}" are empty.',
                  "Check whether the system that produced this file is dropping the field.",
                  _positions(null_mask), series)

    present = series[~null_mask].str.strip()
    if present.empty:
        return

    # --- type check ---------------------------------------------------------
    numbers = None
    bad_type = pd.Series(False, index=present.index)
    if ctype in NUMERIC_TYPES:
        numbers = pd.to_numeric(present, errors="coerce")
        bad_type = numbers.isna()
        if ctype == "integer":
            bad_type = bad_type | ((numbers % 1) != 0)
        numbers = numbers.where(~bad_type)
    elif ctype == "date":
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            bad_type = pd.to_datetime(present, errors="coerce").isna()
    elif ctype == "boolean":
        bad_type = ~present.str.lower().isin(BOOLEAN_TOKENS)

    if bad_type.any():
        n = int(bad_type.sum())
        c.add("error", "wrong_type", name,
              f'{_count(n, "value")} in "{name}" can\'t be read as a {TYPE_LABEL[ctype]}.',
              TYPE_FIX[ctype], _positions(bad_type), series)

    # --- numeric range ------------------------------------------------------
    if numbers is not None:
        if "min" in spec:
            low = numbers < spec["min"]
            if low.any():
                c.add("error", "below_min", name,
                      f'"{name}" has {_count(int(low.sum()), "value")} below the minimum of {spec["min"]}.',
                      f'Values must be {spec["min"]} or higher. Look for typos or sign errors.',
                      _positions(low), series)
        if "max" in spec:
            high = numbers > spec["max"]
            if high.any():
                c.add("error", "above_max", name,
                      f'"{name}" has {_count(int(high.sum()), "value")} above the maximum of {spec["max"]}.',
                      f'Values must be {spec["max"]} or lower. Look for extra digits or unit mix-ups.',
                      _positions(high), series)

    # --- allowed list -------------------------------------------------------
    if "allowed" in spec:
        allowed = {str(v) for v in spec["allowed"]}
        outside = ~present.isin(allowed)
        if outside.any():
            shown = sorted(allowed)
            listing = ", ".join(shown[:10]) + (", ..." if len(shown) > 10 else "")
            c.add("error", "not_allowed", name,
                  f'"{name}" has {_count(int(outside.sum()), "value")} outside the allowed list.',
                  f"Allowed values: {listing}. Check spelling and capital letters.",
                  _positions(outside), series)

    # --- text pattern -------------------------------------------------------
    if "pattern" in spec:
        no_match = ~present.str.fullmatch(spec["pattern"])
        if no_match.any():
            c.add("error", "pattern_mismatch", name,
                  f'Format check failed for {_count(int(no_match.sum()), "value")} in "{name}".',
                  f'Each value must match the pattern {spec["pattern"]}. Look for missing parts, extra spaces or typos.',
                  _positions(no_match), series)

    # --- maximum length -----------------------------------------------------
    if "max_length" in spec:
        too_long = present.str.len() > spec["max_length"]
        if too_long.any():
            c.add("error", "too_long", name,
                  f'"{name}" has {_count(int(too_long.sum()), "value")} longer than {spec["max_length"]} characters.',
                  "Shorten these values, or raise max_length in the contract if longer text is fine.",
                  _positions(too_long), series)

    # --- uniqueness ---------------------------------------------------------
    if spec.get("unique"):
        repeated = present.duplicated(keep=False)
        if repeated.any():
            c.add("error", "duplicate_value", name,
                  f'"{name}" must be unique, but {_count(int(repeated.sum()), "row")} share a value with another row.',
                  "Remove or correct the repeated rows, or confirm this column is really meant to be unique.",
                  _positions(repeated), series)


def validate(df: pd.DataFrame, contract: dict) -> dict:
    """Check the DataFrame against the contract and return summary + grouped issues."""
    total_rows = len(df)
    columns_spec: dict = contract["columns"]
    c = _Collector(df.attrs.get("line_numbers"))

    min_rows = contract.get("min_rows", 1)
    if total_rows < min_rows:
        c.add("error", "too_few_rows", None,
              f"The file has {total_rows} data row(s), but the contract expects at least {min_rows}.",
              "Check that the export finished and that you uploaded the right file.")

    extra = [col for col in df.columns if col not in columns_spec]
    if extra:
        c.add("warning", "unexpected_columns", None,
              f"The file has {_count(len(extra), 'column')} the contract does not mention: {', '.join(extra)}.",
              "If these columns are intended, add them to the contract. Otherwise remove them before passing the file on.")

    if total_rows:
        copies = df.duplicated(keep="first")
        if copies.any():
            c.add("warning", "duplicate_rows", None,
                  f"{_count(int(copies.sum()), 'row')} are exact copies of an earlier row.",
                  "Remove the repeated rows unless duplicates are expected.",
                  _positions(copies))

    for name, spec in columns_spec.items():
        if name not in df.columns:
            if spec.get("required", False):
                close = difflib.get_close_matches(name, list(df.columns), n=1, cutoff=0.6)
                fix = (f'A column called "{close[0]}" exists. Rename it to "{name}" if it holds the same data.'
                       if close else f'Add a "{name}" column to the file.')
                c.add("error", "missing_column", name,
                      f'The required column "{name}" is missing from the file.', fix)
            continue
        _check_column(c, name, spec, df[name], total_rows)

    issues = sorted(c.issues, key=lambda i: (0 if i["severity"] == "error" else 1, -i["affected_count"]))
    errors = sum(1 for i in issues if i["severity"] == "error")
    warns = len(issues) - errors
    status = "failed" if errors else ("passed_with_warnings" if warns else "passed")

    return {
        "summary": {
            "row_count": total_rows,
            "column_count": len(df.columns),
            "error_count": errors,
            "warning_count": warns,
            "rows_with_errors": len(c.error_rows),
            "clean_rate": round(100 * (1 - len(c.error_rows) / total_rows), 1) if total_rows else None,
            "status": status,
        },
        "issues": issues,
    }
