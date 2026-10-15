"""Plain-assert tests. Run from the backend folder with:  python tests/test_validator.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.validator import ContractError, CsvError, load_csv, validate, validate_contract  # noqa: E402

SAMPLE_CSV = Path(__file__).resolve().parents[2] / "frontend" / "public" / "sample-customers.csv"

CONTRACT = {
    "name": "customers_v1",
    "columns": {
        "customer_id": {"type": "integer", "required": True, "unique": True, "min": 1},
        "full_name": {"type": "string", "required": True, "max_length": 50},
        "email": {"type": "string", "required": True, "pattern": r"[^@\s]+@[^@\s]+\.[^@\s]+"},
        "age": {"type": "integer", "min": 18, "max": 100},
        "status": {"type": "string", "required": True, "allowed": ["active", "inactive", "pending"]},
        "signup_date": {"type": "date", "required": True},
        "balance": {"type": "float"},
    },
}


def run(csv_text: str, contract: dict = CONTRACT) -> dict:
    validate_contract(contract)
    return validate(load_csv(csv_text.encode()), contract)


def find(result: dict, rule: str, column: str | None = None) -> dict | None:
    for issue in result["issues"]:
        if issue["rule"] == rule and (column is None or issue["column"] == column):
            return issue
    return None


def test_sample_file_catches_every_planted_problem():
    result = run(SAMPLE_CSV.read_text())
    assert result["summary"]["status"] == "failed"
    assert find(result, "pattern_mismatch", "email")["affected_count"] == 1
    assert find(result, "below_min", "age")["examples"][0]["row"] == 4      # age 17 is on line 4
    assert find(result, "above_max", "age")["examples"][0]["value"] == "150"
    assert find(result, "wrong_type", "age")["examples"][0]["value"] == "abc"
    assert find(result, "wrong_type", "balance")["examples"][0]["value"] == "abc"
    assert find(result, "wrong_type", "signup_date")["examples"][0]["value"] == "13/45/2025"
    assert find(result, "not_allowed", "status")["examples"][0]["value"] == "suspended"
    assert find(result, "missing_value", "full_name")["examples"][0]["row"] == 7
    dup = find(result, "duplicate_value", "customer_id")
    assert dup["affected_count"] == 2 and {e["row"] for e in dup["examples"]} == {5, 6}
    assert find(result, "unexpected_columns")["severity"] == "warning"


def test_clean_file_passes():
    csv_text = "customer_id,full_name,email,age,status,signup_date,balance\n1,Asha,a@b.co,30,active,2025-01-01,10.5\n"
    result = run(csv_text)
    assert result["summary"]["status"] == "passed", result
    assert result["summary"]["clean_rate"] == 100.0


def test_missing_required_column_suggests_rename():
    csv_text = "customer_id,full_name,e-mail,age,status,signup_date\n1,Asha,a@b.co,30,active,2025-01-01\n"
    issue = find(run(csv_text), "missing_column", "email")
    assert issue is not None and "e-mail" in issue["suggestion"]


def test_empty_values_count_as_null_tokens():
    contract = {"columns": {"name": {"type": "string", "required": True}}}
    result = run("name\nAsha\nNULL\n n/a \n\n", contract)
    assert find(result, "missing_value", "name")["affected_count"] >= 2


def test_integer_column_rejects_decimals():
    contract = {"columns": {"qty": {"type": "integer"}}}
    issue = find(run("qty\n1\n2.5\n3\n", contract), "wrong_type", "qty")
    assert issue["affected_count"] == 1 and issue["examples"][0]["value"] == "2.5"


def test_warnings_do_not_fail_the_file():
    contract = {"columns": {"a": {"type": "string"}}}
    result = run("a,b\nx,1\nx,1\n", contract)
    assert result["summary"]["status"] == "passed_with_warnings"
    assert find(result, "duplicate_rows") is not None


def test_bad_contracts_are_rejected_with_clear_messages():
    for bad in [[], {}, {"columns": {}}, {"columns": {"a": {"type": "number"}}},
                {"columns": {"a": {"type": "string", "min": 1}}},
                {"columns": {"a": {"pattern": "("}}}, {"columns": {"a": "text"}}]:
        try:
            validate_contract(bad)
        except ContractError as exc:
            assert str(exc)
        else:
            raise AssertionError(f"contract should have been rejected: {json.dumps(bad)}")


def test_unreadable_files_are_rejected():
    for bad in [b"", b"   \n", b"a;b;c\n1;2;3\n", b"a,b\n1,2,3,4\n1,2\n"]:
        try:
            load_csv(bad)
        except CsvError as exc:
            assert str(exc)
        else:
            raise AssertionError(f"file should have been rejected: {bad!r}")


def test_row_numbers_match_real_line_numbers_even_with_blank_lines():
    contract = {"columns": {"a": {"type": "string", "allowed": ["x", "y"]}}}
    # line 1 header, 2 x, 3 blank, 4 y, 5 z  -> z is on line 5
    issue = find(run("a\nx\n\ny\nz\n", contract), "not_allowed", "a")
    assert issue["examples"][0]["row"] == 5


def test_multiline_cells_report_the_line_where_the_record_starts():
    contract = {"columns": {"a": {"type": "string"}, "n": {"type": "integer"}}}
    # record 1 spans lines 2-3, so the bad value in record 2 is on line 4
    issue = find(run('a,n\n"line one\nline two",5\nbad,oops\n', contract), "wrong_type", "n")
    assert issue["examples"][0]["row"] == 4


def test_header_only_file_triggers_too_few_rows():
    contract = {"columns": {"a": {"type": "string", "required": True}}}
    assert find(run("a\n", contract), "too_few_rows") is not None


def test_duplicate_header_names_are_rejected():
    try:
        load_csv(b"a,a\n1,2\n")
    except CsvError as exc:
        assert "a" in str(exc)
    else:
        raise AssertionError("duplicate header should be rejected")


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
