import { Platform } from "react-native";

const DEFAULT_KEEPR_API_BASE_URL = "https://app.keeprhome.com";

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizePath(path) {
  const value = String(path || "").trim();
  if (!value) return "/";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function explicitApiBaseUrl() {
  return trimTrailingSlash(
    process.env.EXPO_PUBLIC_KEEPR_API_BASE_URL ||
      process.env.PUBLIC_KEEPR_API_BASE_URL ||
      ""
  );
}

function nativeApiBaseUrl() {
  return trimTrailingSlash(
    explicitApiBaseUrl() ||
      process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
      process.env.PUBLIC_KEEPR_BASE_URL ||
      ""
  );
}

function isDevelopmentRuntime() {
  return typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
}

export function resolveKeeprApiBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return explicitApiBaseUrl() || "";
  }

  return nativeApiBaseUrl() || DEFAULT_KEEPR_API_BASE_URL;
}

export function resolveKeeprApiUrl(path) {
  const normalizedPath = normalizePath(path);
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  const baseUrl = resolveKeeprApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export async function keeprApiRequest(path, options = {}) {
  const url = resolveKeeprApiUrl(path);
  const headers = {
    ...(options.headers || {}),
  };

  const bodyIsPlainObject =
    options.body &&
    typeof options.body === "object" &&
    !(typeof FormData !== "undefined" && options.body instanceof FormData) &&
    !(typeof Blob !== "undefined" && options.body instanceof Blob) &&
    !(options.body instanceof ArrayBuffer);

  const requestOptions = {
    ...options,
    headers,
  };

  if (bodyIsPlainObject) {
    requestOptions.body = JSON.stringify(options.body);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  if (isDevelopmentRuntime()) {
    console.log("[keeprApiRequest]", {
      platform: Platform.OS,
      apiBase: resolveKeeprApiBaseUrl(),
      url,
    });
  }

  const res = await fetch(url, requestOptions);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message =
      json?.error ||
      json?.message ||
      text ||
      `Keepr API request failed with HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.url = url;
    error.response = json;
    throw error;
  }

  return json ?? {};
}
