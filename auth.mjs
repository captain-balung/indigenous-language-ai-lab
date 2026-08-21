const encoder = new TextEncoder();

export const AUTH_REALM = "Indigenous Language AI Lab";
export const UNAUTHORIZED_BODY = "需要帳號密碼才能進入。";

export function unauthorizedHeaders() {
  return {
    "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

export function unauthorizedResponse() {
  return new Response(UNAUTHORIZED_BODY, {
    status: 401,
    headers: unauthorizedHeaders()
  });
}

export function readSiteCredentials(env = globalThis.process?.env ?? {}) {
  const user = String(env.SITE_AUTH_USER ?? "").trim();
  const password = String(env.SITE_AUTH_PASSWORD ?? "");
  if (!user || !password) return null;
  return { user, password };
}

export function isAuthorized(request, credentials) {
  if (!credentials) return false;
  const parsed = parseBasicAuth(getAuthorizationHeader(request));
  if (!parsed) {
    timingSafeEqual("", credentials.user);
    timingSafeEqual("", credentials.password);
    return false;
  }
  const userOk = timingSafeEqual(parsed.user, credentials.user);
  const passwordOk = timingSafeEqual(parsed.password, credentials.password);
  return userOk && passwordOk;
}

export function parseBasicAuth(header) {
  if (!header || typeof header !== "string") return null;
  const match = header.match(/^Basic\s+(\S+)/i);
  if (!match) return null;
  let decoded;
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  return {
    user: decoded.slice(0, colon),
    password: decoded.slice(colon + 1)
  };
}

function getAuthorizationHeader(request) {
  const headers = request?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return headers.get("authorization") ?? headers.get("Authorization") ?? "";
  }
  return headers.authorization ?? headers.Authorization ?? "";
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}
