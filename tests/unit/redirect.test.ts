// AUTH-32 and spec 8.5: the return address (`?next=`) must never leave the site or land on /login.
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/redirect";

describe("safeRedirectPath: accepts safe same-origin paths", () => {
  it.each([
    ["/finance", "/finance"],
    ["/finance/reports?year=2026", "/finance/reports?year=2026"],
    ["/letters#top", "/letters#top"],
    ["/", "/"],
    ["/a/b/c?x=1&y=2#z", "/a/b/c?x=1&y=2#z"],
    // Dot segments are resolved, still same origin.
    ["/finance/../letters", "/letters"],
    ["/a/./b", "/a/b"],
    // A backslash after the first path segment is read as "/" by browsers: still same origin.
    ["/a\\b", "/a/b"],
    // Percent-encoded slashes and backslashes stay encoded, so they are not a host separator.
    ["/%2Fevil.example", "/%2Fevil.example"],
    ["/%5Cevil.example", "/%5Cevil.example"],
    // "//" inside the query or hash is harmless.
    ["/?next=//evil.example", "/?next=//evil.example"],
    ["/#//evil.example", "/#//evil.example"],
    ["/@evil.example", "/@evil.example"],
  ])("%j -> %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("safeRedirectPath: rejects everything else (falls back to the home page)", () => {
  it.each([
    ["absolute https URL", "https://evil.example"],
    ["absolute http URL with path", "http://evil.example/finance"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/steal"],
    ["triple slash", "///evil.example"],
    ["slash + backslash", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["backslash only", "\\evil.example"],
    ["slash + double backslash", "/\\\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["scheme without slashes", "https:evil.example"],
    ["no leading slash", "finance"],
    ["relative dot path", "./finance"],
    ["relative parent path", "../finance"],
    ["leading space", " /finance"],
    ["leading space + protocol-relative", " //evil.example"],
    ["empty string", ""],
    ["only whitespace", "   "],
    ["tab inside host trick", "/\t/evil.example"],
    ["newline inside host trick", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["tab at the start", "\t//evil.example"],
    ["NUL byte", "/fin\u0000ance"],
    ["DEL", "/fin\u007fance"],
    ["unit separator", "/fin\u001fance"],
    // After dot-segment resolution this becomes "//evil.example", which a browser reads as another host.
    ["dot segment collapses to //", "/.//evil.example"],
    ["double dot collapses to //", "/a/..//evil.example"],
    ["encoded dot then //", "/./\\evil.example"],
  ])("%s: %j", (_label, input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });
});

describe("safeRedirectPath: never returns to the login page", () => {
  it.each([
    "/login",
    "/login/",
    "/login?next=/finance",
    "/login#x",
    "/login/anything",
    "/finance/../login",
    "/./login",
    "/a/../login?x=1",
  ])("%j -> /", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it("does not treat other paths that merely start with 'login' as the login page", () => {
    expect(safeRedirectPath("/loginx")).toBe("/loginx");
    expect(safeRedirectPath("/logins")).toBe("/logins");
    expect(safeRedirectPath("/finance/login")).toBe("/finance/login");
  });
});

describe("safeRedirectPath: length limit is 512 characters", () => {
  const path = (length: number) => "/" + "a".repeat(length - 1);

  it("accepts exactly 512", () => {
    expect(safeRedirectPath(path(512))).toBe(path(512));
  });
  it("rejects 513", () => {
    expect(safeRedirectPath(path(513))).toBe("/");
  });
  it("rejects a very long value", () => {
    expect(safeRedirectPath(path(100_000))).toBe("/");
  });
  it("rejects a long value that hides a host at the end", () => {
    expect(safeRedirectPath("/" + "a".repeat(600) + "//evil.example")).toBe("/");
  });
});

describe("safeRedirectPath: non-string input", () => {
  it.each([null, undefined])("%s -> /", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });
  it("numbers, objects and arrays -> / (query values can be arrays)", () => {
    expect(safeRedirectPath(123 as unknown as string)).toBe("/");
    expect(safeRedirectPath({} as unknown as string)).toBe("/");
    expect(safeRedirectPath(["/finance"] as unknown as string)).toBe("/");
  });
});

describe("safeRedirectPath: result is always safe (fuzz)", () => {
  const pieces = ["/", "\\", "//", "/\\", ".", "..", "login", "evil.example", "%2F", "%5C", "?", "#", ":", "@", "a", "\t", "\n", " "];
  it("never returns a protocol-relative, backslash, absolute, or /login result", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 5000; i++) {
      const length = 1 + Math.floor(rand() * 6);
      let value = "";
      for (let j = 0; j < length; j++) value += pieces[Math.floor(rand() * pieces.length)];
      const out = safeRedirectPath(value);
      expect(out.startsWith("/"), `${JSON.stringify(value)} -> ${out}`).toBe(true);
      expect(out.startsWith("//"), `${JSON.stringify(value)} -> ${out}`).toBe(false);
      expect(out.startsWith("/\\"), `${JSON.stringify(value)} -> ${out}`).toBe(false);
      expect(/^\/login(\/|$|\?|#)/.test(out), `${JSON.stringify(value)} -> ${out}`).toBe(false);
      expect(out.length).toBeLessThanOrEqual(512);
      // The browser must resolve it on the same origin.
      expect(new URL(out, "https://nexus.example").origin).toBe("https://nexus.example");
    }
  });
});

describe("safeRedirectPath: percent-encoded dot segments and encoded login", () => {
  it.each(["/%2e%2e/login", "/%2E%2E/login", "/.%2e/login", "/%2e/login", "/a/%2e%2e/login?x=1", "/%2e%2e//evil.example"])(
    "%j -> /",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );

  it("an encoded slash in the login path is not the login page and never becomes a host", () => {
    const out = safeRedirectPath("/login%2f");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
  });

  it("unicode look-alikes do not become a host separator", () => {
    // U+2215 DIVISION SLASH and U+FF0F FULLWIDTH SOLIDUS are not "/" for URL parsers.
    for (const input of ["/∕∕evil.example", "／／evil.example", "/／evil.example"]) {
      const out = safeRedirectPath(input);
      expect(new URL(out, "https://nexus.example").origin).toBe("https://nexus.example");
    }
  });
});
