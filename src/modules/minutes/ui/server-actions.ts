// The one place the Meeting Minutes screens import Server Actions from (contract section 12 names). The
// backend owns the "use server" wrappers in src/app/(app)/notulensi/actions.ts; if they move, only this
// file changes. Every action checks the session and the right again; the database checks a third time.
export {
  addMinuteFiles,
  getMinuteFileLink,
  recordMinute,
  updateMinute,
  voidMinute,
  withdrawMinuteFile,
} from "@/app/(app)/notulensi/actions";
