/**
 * Prisma maps Postgres BIGINT columns (Organization.storageLimitBytes,
 * FileAsset.sizeBytes, MeetingRecording.sizeBytes) to native JS `bigint`, which
 * `JSON.stringify` cannot serialize by default — any response containing one
 * would throw `TypeError: Do not know how to serialize a BigInt` instead of
 * silently dropping the field. Stringify it instead: clients receive these
 * fields as numeric strings, not numbers (matches how the web/mobile clients'
 * types declare them — see e.g. RecordingsPanel's `sizeBytes: string | null`).
 *
 * Side-effect import only — `import "./common/lib/bigint-json"` at the very top
 * of main.ts, before any request can be handled.
 */
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
  return this.toString();
};
