// Access to NEXUS's OWN local Supabase stack (D-018) for tests. LOCAL ONLY.
// Reads the API URL and the PUBLISHABLE key from .env.local (both are public values). The service key is never used.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = process.cwd();
export const CACHE_DIR = join(ROOT, "node_modules", ".cache", "pmk-nexus-e2e");

export const PASSWORD = "NexusLocal2026";
export const PERSONAS = {
  regular: { email: "member.regular@nexus.test", name: "Member Regular" },
  temppw: { email: "member.temppw@nexus.test" },
  inactive: { email: "member.inactive@nexus.test" },
  unlinked: { email: "unlinked@nexus.test" },
  ketum: { email: "ketum@nexus.test" },
  bendahara: { email: "bendahara@nexus.test" },
  admin: { email: "admin@nexus.test" },
} as const;
export type PersonaKey = keyof typeof PERSONAS;

function envFile(): Record<string, string> {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(".env.local not found. Copy .env.example and fill in the local stack values.");
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = envFile();
export const API_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const PICORE_URL = (env.NEXT_PUBLIC_PICORE_URL ?? "").replace(/\/+$/, "");

/** Hard stop if the tests would run against anything but the local NEXUS stack. */
export function assertLocalStack() {
  const u = new URL(API_URL);
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "55431") {
    throw new Error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${API_URL}) is not the local NEXUS stack (http://127.0.0.1:55431).`);
  }
  if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.startsWith("sb_secret_")) throw new Error("Missing or unsafe publishable key in .env.local.");
}

/** Runs one SQL statement in the local NEXUS database container. Returns trimmed stdout. */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pmk-nexus", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

export function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}
export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(CACHE_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}
export function writeJson(name: string, value: unknown) {
  ensureCacheDir();
  writeFileSync(join(CACHE_DIR, name), JSON.stringify(value));
}
