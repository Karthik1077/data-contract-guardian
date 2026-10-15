import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadReport, getUpload, listUploads, validateFile } from "./api";
import ContractPanel from "./components/ContractPanel";
import Header from "./components/Header";
import type { Theme } from "./components/Header";
import HistoryDrawer from "./components/HistoryDrawer";
import ResultView from "./components/ResultView";
import Toasts from "./components/Toasts";
import type { ToastItem } from "./components/Toasts";
import UploadPanel from "./components/UploadPanel";
import { parseContract, serializeContract } from "./contract";
import { inferContract, parseCsv } from "./csv";
import type { ParsedCsv } from "./csv";
import { SAMPLE_CONTRACT } from "./sample";
import type { UploadRow, ValidationResult } from "./types";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("dcg-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage is blocked: fall through to the system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [contractText, setContractText] = useState(SAMPLE_CONTRACT);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [resultParsed, setResultParsed] = useState<ParsedCsv | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [history, setHistory] = useState<UploadRow[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const resultRef = useRef<HTMLDivElement>(null);
  const fileToken = useRef(0);
  const toastId = useRef(0);

  const contractCheck = useMemo(() => parseContract(contractText), [contractText]);
  const canValidate = file !== null && contractCheck.ok && !loading;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("dcg-theme", theme);
    } catch {
      // Not saving the theme is harmless.
    }
  }, [theme]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (text: string, actionLabel?: string, onAction?: () => void) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((prev) => [...prev.slice(-2), { id, text, actionLabel, onAction }]);
      window.setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listUploads());
    } catch {
      // History is a nice-to-have: if it fails, the main feature still works.
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  function handleFile(next: File | null) {
    fileToken.current += 1;
    const token = fileToken.current;
    setFile(next);
    setParsed(null);
    setError("");
    if (!next) {
      setParsing(false);
      return;
    }
    setParsing(true);
    next
      .text()
      .then((text) => {
        if (token === fileToken.current) setParsed(parseCsv(text));
      })
      .catch(() => {
        if (token === fileToken.current) pushToast("Could not read that file in the browser. You can still try validating it.");
      })
      .finally(() => {
        if (token === fileToken.current) setParsing(false);
      });
  }

  async function handleTrySample() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample-customers.csv`);
      if (!res.ok) throw new Error("missing");
      const blob = await res.blob();
      setContractText(SAMPLE_CONTRACT);
      handleFile(new File([blob], "sample-customers.csv", { type: "text/csv" }));
    } catch {
      setError("Could not load the sample file.");
    }
  }

  function handleSuggest() {
    if (!file || !parsed) return;
    const before = contractText;
    setContractText(serializeContract(inferContract(file.name, parsed)));
    pushToast("Contract suggested from your file. Review it before you validate.", "Undo", () => setContractText(before));
  }

  function showResult(next: ValidationResult, source: ParsedCsv | null) {
    setResult(next);
    setResultParsed(source);
    setResultKey((k) => k + 1);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function handleValidate() {
    if (!file || !contractCheck.ok || loading) return;
    setError("");
    setLoading(true);
    // Free hosting puts the server to sleep when idle; say so if the first call is slow.
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      showResult(await validateFile(file, contractText), parsed);
      void refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setLoading(false);
    }
  }

  async function handleOpen(id: number) {
    setError("");
    try {
      showResult(await getUpload(id), null);
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that result.");
      setDrawerOpen(false);
    }
  }

  async function handleDownload() {
    if (result?.id == null) return;
    try {
      await downloadReport(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the report.");
    }
  }

  // Keyboard: Ctrl/Cmd + Enter validates, Escape closes the history drawer.
  const validateRef = useRef(handleValidate);
  validateRef.current = handleValidate;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void validateRef.current();
      } else if (e.key === "Escape") {
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // How this check compares with the previous check of the same contract.
  const delta = useMemo(() => {
    if (!result || result.id === null || result.summary.clean_rate === null) return null;
    const previous = history.find((h) => h.contract_name === result.contract_name && h.id < (result.id as number));
    if (!previous || previous.summary.clean_rate === null) return null;
    return Math.round((result.summary.clean_rate - previous.summary.clean_rate) * 10) / 10;
  }, [result, history]);

  const actionNote = !file
    ? "Choose a CSV to continue."
    : !contractCheck.ok
      ? "Fix the contract JSON before you validate."
      : parsed
        ? `${file.name} is ready, ${parsed.rows.length} rows against ${contractCheck.contract.name ?? "your contract"}.`
        : `${file.name} is ready.`;

  return (
    <>
      <Header
        theme={theme}
        historyCount={history.length}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onOpenHistory={() => setDrawerOpen(true)}
      />

      <main className="wrap">
        <section className="hero">
          <h1>Catch bad data before it ships.</h1>
          <p className="lede">
            Describe what a valid CSV looks like, drop a file in, and get every problem explained in plain language with the exact
            lines to fix.
          </p>
        </section>

        <div className="surface workspace">
          <ContractPanel contractText={contractText} onChange={setContractText} />
          <UploadPanel
            file={file}
            parsed={parsed}
            parsing={parsing}
            onFile={handleFile}
            onSuggest={handleSuggest}
            onTrySample={handleTrySample}
          />
          <div className="action-bar">
            <p className="action-note">{actionNote}</p>
            <button type="button" className="primary" disabled={!canValidate} onClick={() => void handleValidate()}>
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Checking
                </>
              ) : (
                <>
                  Validate file
                  <span className="kbd" aria-hidden="true">
                    Ctrl Enter
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {slow && <p className="notice">Waking up the free server. The first check after a quiet period can take up to a minute.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div ref={resultRef}>
          {result && (
            <ResultView
              key={resultKey}
              result={result}
              delta={delta}
              parsed={resultParsed}
              onDownload={() => void handleDownload()}
              onToast={(text) => pushToast(text)}
            />
          )}
        </div>
      </main>

      <footer className="wrap foot">
        Built with React, TypeScript, FastAPI, pandas and PostgreSQL. Only a few example values per issue are stored, never the whole file.
      </footer>

      <HistoryDrawer
        open={drawerOpen}
        uploads={history}
        activeId={result?.id ?? null}
        onClose={() => setDrawerOpen(false)}
        onOpen={(id) => void handleOpen(id)}
      />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
