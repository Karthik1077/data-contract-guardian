import { useMemo, useRef, useState } from "react";
import { detectColumnTypes } from "../csv";
import type { ParsedCsv } from "../csv";
import { IconClose, IconFile, IconUpload, IconWand } from "./Icons";

interface Props {
  file: File | null;
  parsed: ParsedCsv | null;
  parsing: boolean;
  onFile: (file: File | null) => void;
  onSuggest: () => void;
  onTrySample: () => void;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPanel({ file, parsed, parsing, onFile, onSuggest, onTrySample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const types = useMemo(() => (parsed ? detectColumnTypes(parsed) : []), [parsed]);

  return (
    <section className="pane" aria-labelledby="step-file">
      <div className="pane-head">
        <div className="step">
          <span className="step-num">2</span>
          <h2 id="step-file">Add your CSV</h2>
        </div>
      </div>
      <p className="hint">Drop in the file you want to check. It stays in your browser until you press Validate.</p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      {!file ? (
        <>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files[0] ?? null);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <IconUpload size={26} />
            <strong>Drop a CSV here, or click to browse</strong>
            <span>Up to 5 MB, comma separated</span>
          </div>
          <div className="sample-row">
            No file handy?
            <button type="button" className="link-btn" onClick={onTrySample}>
              Try the sample file
            </button>
            , which has deliberate mistakes.
          </div>
        </>
      ) : (
        <>
          <div className="file-card">
            <span className="file-icon">
              <IconFile size={20} />
            </span>
            <div className="file-meta">
              <strong>{file.name}</strong>
              <span>
                {formatSize(file.size)}
                {parsed ? `, ${parsed.rows.length} rows, ${parsed.header.length} columns` : ""}
              </span>
            </div>
            <button type="button" className="tiny-btn" onClick={() => inputRef.current?.click()} aria-label="Choose a different file">
              <IconUpload size={16} />
            </button>
            <button type="button" className="tiny-btn" onClick={() => onFile(null)} aria-label="Remove file">
              <IconClose size={16} />
            </button>
          </div>

          {parsing && <div className="skeleton" aria-hidden="true" />}

          {parsed && parsed.header.length > 0 && (
            <>
              <div className="preview" tabIndex={0} aria-label="Preview of the first rows">
                <table>
                  <thead>
                    <tr>
                      {parsed.header.map((h, i) => (
                        <th key={`${h}-${i}`}>
                          {h || "(blank)"}
                          <span className="type-tag">looks like {types[i]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 6).map((row, r) => (
                      <tr key={r}>
                        {parsed.header.map((_, c) => (
                          <td key={c}>{row[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="ghost suggest" onClick={onSuggest}>
                <IconWand size={16} />
                Suggest a contract from this file
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
