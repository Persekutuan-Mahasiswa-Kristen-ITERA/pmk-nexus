import { redirect } from "next/navigation";
import type { LetterError } from "../types";

/**
 * What a page shows for a failed read. An ended session goes back to login with the notice and returns
 * to `next` afterwards (auth-login F9). A lost right is the Forbidden screen. Everything unexpected is
 * "Terjadi gangguan" (fail closed; never shown as "no access", never a sign-out).
 */
export type PageFailure = "forbidden" | "not_found" | "invalid" | "unavailable";

export function pageFailure(error: LetterError, next: string): PageFailure {
  switch (error.code) {
    case "unauthenticated":
      return redirect(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "invalid_input":
    case "invalid_dates":
      return "invalid";
    default:
      return "unavailable";
  }
}
