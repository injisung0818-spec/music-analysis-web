import type { Analysis, JobResponse } from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function uploadAudio(file: File): Promise<JobResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json();
}

export async function fetchJob(id: string): Promise<JobResponse> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json();
}

export async function fetchJobs(): Promise<JobResponse[]> {
  const response = await fetch(`${API_BASE}/api/jobs`);
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json();
}

export async function fetchAnalysis(id: string): Promise<Analysis> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}/analysis`);
  if (!response.ok) {
    throw new Error(await readableError(response));
  }
  return response.json();
}

export async function deleteJob(id: string): Promise<void> {
  const attempts = [
    { url: `${API_BASE}/api/jobs/${id}`, method: "DELETE" },
    { url: `${API_BASE}/api/jobs/${id}/delete`, method: "POST" },
    { url: `${API_BASE}/api/jobs/delete/${id}`, method: "POST" }
  ];
  let lastMessage = "";
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, { method: attempt.method });
    if (response.status === 204 || response.ok) return;
    if (response.status === 404) return;
    lastMessage = await readableError(response);
    if (response.status !== 405) {
      throw new Error(lastMessage);
    }
  }
  throw new Error(lastMessage || "백엔드 서버의 API가 아직 최신 코드로 실행되지 않았습니다. 서버를 재시작한 뒤 다시 시도하세요.");
}

export function assetUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

export function exportMixUrl(id: string): string {
  return `${API_BASE}/api/jobs/${id}/export/mix`;
}

export function exportStemsUrl(id: string, stems: string[], mode = "mix"): string {
  const params = new URLSearchParams();
  stems.forEach((stem) => params.append("stem", stem));
  params.set("mode", mode);
  return `${API_BASE}/api/jobs/${id}/export/stems?${params.toString()}`;
}

async function readableError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { detail?: string };
    if (parsed.detail === "Method Not Allowed") {
      return "백엔드 서버의 API가 아직 최신 코드로 실행되지 않았습니다. 서버를 재시작한 뒤 다시 시도하세요.";
    }
    return parsed.detail ?? text;
  } catch {
    return text || response.statusText;
  }
}
