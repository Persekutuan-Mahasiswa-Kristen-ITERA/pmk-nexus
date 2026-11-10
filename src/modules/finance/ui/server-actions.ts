// The one place the Finance screens import Server Actions from (contract section 13 names). The backend
// owns the "use server" wrappers in src/app/(app)/finance/actions.ts; if they move, only this file changes.
// Every action checks the session and the right again; the database checks a third time.
export { addFinanceProof, getFinanceProofLink, recordFinanceEntry, voidFinanceEntry, withdrawFinanceProof } from "@/app/(app)/finance/actions";
