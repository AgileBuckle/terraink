import type { IHttp } from "./ports";

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const { signal: externalSignal, ...restOptions } = options;

  let onExternalAbort: (() => void) | null = null;
  if (externalSignal) {
    onExternalAbort = () => controller.abort();
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...restOptions, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

export const fetchAdapter: IHttp = {
  get(
    url: string,
    options: RequestInit = {},
    timeoutMs = 20_000,
  ): Promise<Response> {
    return fetchWithTimeout(url, { ...options, method: "GET" }, timeoutMs);
  },

  post(
    url: string,
    body: string,
    options: RequestInit = {},
    timeoutMs = 20_000,
  ): Promise<Response> {
    return fetchWithTimeout(
      url,
      { ...options, method: "POST", body },
      timeoutMs,
    );
  },
};
