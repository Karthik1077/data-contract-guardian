# Data Contract Guardian

Upload a CSV, check it against a **data contract** (a JSON description of what a valid file looks like), and get every problem back in plain language with a suggested fix, before bad data reaches a database or report.

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![pandas](https://img.shields.io/badge/pandas-150458?logo=pandas&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react&logoColor=white)

**Live demo:** _add your Vercel link here_

## Screenshots

_Add screenshots to a `screenshots` folder and reference them here, for example:_

```markdown
![Failed validation](./screenshots/failed.png)
```

## Features

- **Contract-driven validation:** required columns, types (string, integer, float, date, boolean), min/max, allowed values, regex patterns, maximum length, uniqueness, minimum row count
- **Plain-language explanations:** every issue says what went wrong and how to fix it, with example values and the exact line numbers from the user's file
- **Errors vs warnings:** errors fail the file; warnings (extra columns, duplicate rows, many blanks) are reported but do not
- **Helpful suggestions:** a missing column that looks like a misspelled one gets a "rename it" hint
- **History and reports:** every check is saved per browser, and any result can be downloaded as a CSV report
- **Visual contract builder:** edit columns, types and rules with a form, or switch to raw JSON; both stay in sync
- **Suggest a contract from a file:** the browser profiles your CSV and proposes types, required, unique and allowed values
- **Flagged rows view:** the exact rows from your file that failed, with the offending cells highlighted
- **Score seal and trend:** animated clean-rate seal, comparison with your previous check, and a history drawer with a trend line
- **Search, filter and group** issues by severity or column; download CSV or JSON reports; copy a plain-text summary
- **Dark and light themes**, keyboard shortcut (Ctrl/Cmd + Enter to validate), responsive down to phones
- **Safe by design:** file size limit, spreadsheet-formula-injection protection in reports, only a few example values stored (never the whole file)

## How it works

```
 Browser (React + TypeScript)
        |  multipart upload: CSV + contract JSON
        v
 FastAPI  --->  validator.py (pandas)  --->  issues grouped by rule and column
        |
        v
 PostgreSQL: uploads + issues (history, reports)
```

| Layer | Technology | Job |
|---|---|---|
| Validation | Python, pandas | Reads the file and runs every contract rule |
| API | FastAPI | Receives uploads, returns results, serves history and reports |
| Database | PostgreSQL | Stores upload history and validation results |
| Frontend | React, TypeScript, Vite | Upload page, results, history |

## The data contract

```json
{
  "name": "customers_v1",
  "min_rows": 1,
  "columns": {
    "customer_id": { "type": "integer", "required": true, "unique": true, "min": 1 },
    "email":       { "type": "string",  "required": true, "pattern": "[^@\\s]+@[^@\\s]+\\.[^@\\s]+" },
    "status":      { "type": "string",  "allowed": ["active", "inactive", "pending"] },
    "signup_date": { "type": "date" }
  }
}
```

| Rule | Applies to | Meaning |
|---|---|---|
| `type` | all | `string`, `integer`, `float`, `date`, `boolean` |
| `required` | all | the column must exist and have no empty values |
| `unique` | all | no value may repeat |
| `min`, `max` | integer, float | numeric range |
| `allowed` | all | value must be in this list |
| `pattern` | all | value must fully match this regular expression |
| `max_length` | all | longest allowed text |
| `min_rows` | file | minimum number of data rows (default 1) |

Empty means blank, `null`, `none`, `nan`, `n/a` or `na` (any capitalisation). Dates must use one consistent format such as `2025-01-31`.

## Run it locally

You need Python 3.11+, Node.js 18+ and a PostgreSQL database (a free [Supabase](https://supabase.com) project works).

**Backend**

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env         # then edit DATABASE_URL (macOS/Linux: cp)
python tests/test_validator.py # optional: runs the validator tests
python -m uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/api/health. You should see `{"status":"ok","database":true}`. Tables are created automatically on startup. API docs are at http://localhost:8000/docs.

**Frontend** (second terminal)

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:5173, press **Validate file** after choosing the sample CSV.

## Deploy for free

1. **Database:** create a Supabase project with a password of **letters and numbers only**, then copy the *Shared pooler* connection string.
2. **Backend on Render:** New, Web Service, connect this repo. Root directory `backend`. Build command `pip install -r requirements.txt`. Start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Instance type Free. Environment variables: `DATABASE_URL`, `CORS_ORIGINS` (set after step 3), `PYTHON_VERSION=3.12.7`.
3. **Frontend on Vercel:** New Project, import this repo. Root directory `frontend`. Environment variable `VITE_API_URL` = your Render URL with no trailing slash.
4. Go back to Render and set `CORS_ORIGINS` to your Vercel URL, then let it redeploy.

The free Render server sleeps after about 15 minutes idle, so the first request afterwards can take up to a minute. The app says so while it waits.

## Design decisions

- **Everything is read as text first.** The validator decides what counts as a number or date instead of letting pandas guess, so "12,50" is flagged rather than silently becoming something else.
- **True line numbers.** The file is parsed with Python's `csv` module so "line 17" in a report is line 17 in the user's spreadsheet, even with blank lines or multi-line cells. Plain `read_csv` also shifts columns silently when a row has too many values, which a data-quality tool must not do.
- **Grouped issues.** One issue per rule and column with a count and a few examples, not thousands of rows of noise.
- **No accounts.** Each browser gets a random id and sees only its own history. This separates users but is not authentication, which is why only a few example values are stored.
- **Report CSVs neutralise formulas.** Cells starting with `=`, `+`, `-` or `@` are prefixed so opening a report in Excel cannot run injected formulas.

## Roadmap

- **GenAI explanations (optional):** send an issue's rule, column and examples to an LLM and show a friendlier explanation and fix. The current explanations are rule-based templates, so the tool works without any AI service.
- Save and reuse named contracts
- Generate a starter contract by profiling an uploaded file
- Excel (`.xlsx`) uploads
