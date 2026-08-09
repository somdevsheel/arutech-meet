import { createHash } from "crypto";

/** SHA-256 hex digest — used to store a lookup-safe hash of refresh/invite tokens
 * (the raw token is only ever held by the client; the DB never stores it in the clear). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
