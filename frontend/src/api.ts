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

export async function fetchAnalysis(id: string): Promise<Analysis> {
  const response = await fetch(`${API_BASE}/api/jobs/${id}/analysis`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function assetUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}
