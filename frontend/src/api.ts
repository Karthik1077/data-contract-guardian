import type { UploadRow, ValidationResult } from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";
const CLIENT_KEY = "dcg-client-id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// Each browser gets a random id so it only sees its own upload history.
let memoryId: string | null = null;
export function getClientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_KEY);
    if (stored) return stored;
    const fresh = randomId();
    localStorage.setItem(CLIENT_KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode): fall back to an id that lasts until the tab closes.
    memoryId = memoryId ?? randomId();
    return memoryId;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail.map((d: { msg?: string }) => d.msg ?? "Invalid request").join("; ");
    }
  } catch {
    // the body was not JSON
  }
  return `The server answered with an error (${res.status}).`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "X-Client-Id": getClientId(), ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error(
      "Could not reach the server. If nobody has used it for a while, the free server may still be waking up. Wait a minute and try again.",
    );
  }
  if (!res.ok) throw new Error(await readError(res));
  return res;
}

export async function validateFile(file: File, contractText: string): Promise<ValidationResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("contract", contractText);
  const res = await request("/api/validate", { method: "POST", body: form });
  return res.json();
}

export async function listUploads(): Promise<UploadRow[]> {
  const res = await request("/api/uploads");
  return (await res.json()).uploads;
}

export async function getUpload(id: number): Promise<ValidationResult> {
  const res = await request(`/api/uploads/${id}`);
  return res.json();
}

export async function downloadReport(id: number): Promise<void> {
  const res = await request(`/api/uploads/${id}/report.csv`);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `report-${id}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
