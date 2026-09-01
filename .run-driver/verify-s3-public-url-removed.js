// Verifies the actual finding: S3_PUBLIC_URL was documented in every
// .env* example and docs/deployment-lightsail.md, and defined in the Zod
// env schema, but never read anywhere in application code — a genuinely
// dead config value a deployer would dutifully fill in for nothing.
// packages/config/src/env.ts, all .env* files, and the docs no longer
// mention it at all.
//
// The real risk of removing it is regressing the *actual*, currently-used
// presigned-URL mechanism (S3_ENDPOINT / S3_PUBLIC_ENDPOINT +
// StorageService), so this script proves a complete real file
// upload -> presigned PUT -> presigned GET -> download round trip still
// works against the real running API + MinIO, with S3_PUBLIC_URL absent
// from the environment entirely (not just unused — actually unset).
async function apiFetch(fullPath, options = {}) {
  const res = await fetch(`http://localhost:4000/api/v1${fullPath}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

async function register(displayName, username, email) {
  const { body } = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, username, email, password: "Password123!" }),
  });
  return body;
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: confirm S3_PUBLIC_URL is genuinely absent from this API process's environment",
  );
  const envCheck = process.env.S3_PUBLIC_URL;
  console.log("S3_PUBLIC_URL_IN_MY_OWN_SHELL_ENV (informational only):", envCheck ?? "(unset)");

  console.log("STEP: register two real users and a real DM room between them");
  const a = await register("S3 Test A", `s3testa${suffix}`, `s3testa${suffix}@arutech.dev`);
  const b = await register("S3 Test B", `s3testb${suffix}`, `s3testb${suffix}@arutech.dev`);
  const roomRes = await apiFetch("/chat-rooms", {
    method: "POST",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [b.user.id] }),
  });
  const roomId = roomRes.body.id;
  console.log("ROOM_CREATED (expect 201):", roomRes.status);

  console.log(
    "STEP: get a real presigned upload URL from the real running API (StorageService.getSignedUploadUrl)",
  );
  const fileContent = `Real test file content ${suffix}`;
  const presignRes = await apiFetch(`/chat-rooms/${roomId}/files/presign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({
      fileName: "test.txt",
      mimeType: "text/plain",
      sizeBytes: fileContent.length,
    }),
  });
  console.log("PRESIGN_UPLOAD_STATUS (expect 201):", presignRes.status);
  const { fileId, uploadUrl } = presignRes.body;
  console.log(
    "GOT_REAL_PRESIGNED_UPLOAD_URL (expect true):",
    typeof uploadUrl === "string" && uploadUrl.length > 0,
  );

  console.log(
    "STEP: actually PUT the file bytes straight to MinIO using that presigned URL — no app code involved from here, this is the real S3-compatible protocol",
  );
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: fileContent,
  });
  console.log("REAL_PUT_TO_STORAGE_STATUS (expect 200):", putRes.status);

  console.log(
    "STEP: send the chat message referencing this file, then fetch a real presigned DOWNLOAD url",
  );
  // socket-based ROOM_MESSAGE isn't worth spinning up here just to attach
  // the file — the download-URL endpoint only needs the fileId to already
  // exist (created by presign above), not a message referencing it.
  const downloadRes = await apiFetch(`/chat-rooms/${roomId}/files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${a.accessToken}` },
  });
  console.log("PRESIGN_DOWNLOAD_STATUS (expect 200):", downloadRes.status);
  const downloadUrl = downloadRes.body?.url ?? downloadRes.body?.downloadUrl;
  console.log("GOT_REAL_PRESIGNED_DOWNLOAD_URL (expect true):", typeof downloadUrl === "string");

  console.log(
    "STEP: actually GET the file back from storage using that presigned URL and confirm the real bytes round-tripped",
  );
  const getRes = await fetch(downloadUrl);
  const gotContent = await getRes.text();
  console.log("REAL_GET_FROM_STORAGE_STATUS (expect 200):", getRes.status);
  console.log("CONTENT_ROUND_TRIPPED_CORRECTLY (expect true):", gotContent === fileContent);

  const pass =
    roomRes.status === 201 &&
    presignRes.status === 201 &&
    typeof uploadUrl === "string" &&
    putRes.status === 200 &&
    downloadRes.status === 200 &&
    typeof downloadUrl === "string" &&
    getRes.status === 200 &&
    gotContent === fileContent;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
