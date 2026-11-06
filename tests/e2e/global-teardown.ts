import { sql } from "../support/local-stack";
import { CANONICAL_RESET_SQL } from "./global-setup";

// Leave the local seed exactly as documented, even if a test died halfway.
export default async function globalTeardown() {
  sql(CANONICAL_RESET_SQL);
}
