export class HttpServiceError extends Error {
  constructor(message, { status = 0, code = "HTTP_ERROR", retryable = false } = {}) {
    super(message);
    this.name = "HttpServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 12000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new HttpServiceError("外部服务返回了非 JSON 内容", {
        status: response.status,
        code: "INVALID_JSON",
        retryable: response.status >= 500,
      });
    }
    if (!response.ok) {
      const detail = data?.error?.detail || data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new HttpServiceError(String(detail).slice(0, 240), {
        status: response.status,
        code: response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new HttpServiceError("外部服务请求超时", { code: "TIMEOUT", retryable: true });
    }
    if (error instanceof HttpServiceError) throw error;
    throw new HttpServiceError("外部服务网络请求失败", { code: "NETWORK_ERROR", retryable: true });
  } finally {
    clearTimeout(timer);
  }
}
