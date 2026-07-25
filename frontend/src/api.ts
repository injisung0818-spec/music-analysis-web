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
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchJob(id: string): Promise<JobResponse> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchJobs(): Promise<JobResponse[]> {
  const response = await fetch(`${API_BASE}/api/jobs`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchAnalysis(id: string): Promise<Analysis> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}/analysis`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function deleteJob(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}`, {
    method: "DELETE"
  });
  if (response.status === 404) return;
  if (response.status === 405) {
    const fallback = await fetch(`${API_BASE}/api/jobs/${id}/delete`, {
      method: "POST"
    });
    if (fallback.status === 404) return;
    if (fallback.status === 405) {
      throw new Error("백엔드 서버가 삭제 API를 아직 반영하지 않았습니다. 서버를 재시작한 뒤 다시 삭제하세요.");
    }
    if (!fallback.ok) {
      throw new Error(await fallback.text());
    }
    return;
  }
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export function assetUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}
