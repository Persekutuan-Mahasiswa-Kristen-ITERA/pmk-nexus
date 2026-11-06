// Return-address check for `?next=` (docs/modules/auth-login.md section 8.5, AUTH-32). Pure: safe on
// server and browser. Same rules as PI-CORE's helper, written here because NEXUS never imports PI-CORE code.

const HOME = "/";
const MAX_LENGTH = 512;
// A throwaway origin: only used to resolve the path, never shown or followed.
const BASE = "http://nexus.invalid";

/** Returns `value` only if it is a same-origin absolute path that is not the login page; else "/". */
export function safeRedirectPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return HOME;
  // Control characters (incl. tab, newline, DEL) can trick URL parsers into a different host.
  if (/[\u0000-\u001f\u007f]/.test(value)) return HOME;
  if (!isPlainPath(value)) return HOME;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return HOME;
  }
  if (url.origin !== BASE) return HOME;

  const result = `${url.pathname}${url.search}${url.hash}`;
  // Re-check after normalization: "/.//evil.example" resolves to the path "//evil.example", which a
  // browser would read as another host.
  if (!isPlainPath(result) || result.length > MAX_LENGTH) return HOME;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return HOME;
  return result;
}

/** Starts with exactly one "/" and is not protocol-relative ("//host" or "/\host"). */
function isPlainPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}
