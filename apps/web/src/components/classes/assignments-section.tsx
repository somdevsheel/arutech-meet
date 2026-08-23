"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

interface FileRef {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: string;
}

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  createdAt: string;
  file: FileRef | null;
}

interface Submission {
  id: string;
  studentId: string;
  textContent: string | null;
  status: "SUBMITTED" | "RESUBMITTED" | "GRADED";
  score: number | null;
  feedback: string | null;
  submittedAt: string;
  file: FileRef | null;
  student?: { id: string; displayName: string; avatarUrl: string | null };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFile(classId: string, file: File): Promise<string> {
  const { fileId, uploadUrl } = await apiFetch<{ fileId: string; uploadUrl: string }>(
    `/classes/${classId}/assignments/presign`,
    { method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }) },
  );
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return fileId;
}

function AttachmentLink({ classId, assignmentId, file }: { classId: string; assignmentId: string; file: FileRef }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/classes/${classId}/assignments/${assignmentId}/files/${file.id}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={download} disabled={busy} className="text-brand-300 hover:underline disabled:opacity-50">
      📎 {file.originalName} ({formatSize(Number(file.sizeBytes))})
    </button>
  );
}

export function AssignmentsSection({ classId, isTeacher }: { classId: string; isTeacher: boolean }) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => apiFetch<Assignment[]>(`/classes/${classId}/assignments`).then(setAssignments);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Assignments</h2>
        {isTeacher && (
          <button
            onClick={() => setShowNewForm((v) => !v)}
            className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          >
            {showNewForm ? "Cancel" : "+ New assignment"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {showNewForm && (
        <NewAssignmentForm
          classId={classId}
          onCreated={() => {
            setShowNewForm(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      <ul className="flex flex-col gap-2">
        {assignments?.length === 0 && <li className="text-sm text-ink-muted">No assignments yet.</li>}
        {assignments?.map((a) => (
          <li key={a.id} className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{a.title}</p>
                {a.description && <p className="mt-0.5 text-xs text-ink-muted">{a.description}</p>}
                <p className="mt-1 text-[11px] text-ink-muted2">
                  {a.dueAt ? `Due ${new Date(a.dueAt).toLocaleString()}` : "No due date"}
                </p>
                {a.file && (
                  <div className="mt-1 text-xs">
                    <AttachmentLink classId={classId} assignmentId={a.id} file={a.file} />
                  </div>
                )}
              </div>
              <button
                onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                className="flex-none text-xs text-brand-300 hover:underline"
              >
                {expandedId === a.id ? "Hide" : isTeacher ? "View submissions" : "Submit / view grade"}
              </button>
            </div>

            {expandedId === a.id &&
              (isTeacher ? (
                <TeacherSubmissions classId={classId} assignmentId={a.id} />
              ) : (
                <StudentSubmission classId={classId} assignmentId={a.id} />
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewAssignmentForm({
  classId,
  onCreated,
  onError,
}: {
  classId: string;
  onCreated: () => void;
  onError: (msg: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    onError(null);
    try {
      let fileId: string | undefined;
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${formatSize(MAX_UPLOAD_BYTES)})`);
        fileId = await uploadFile(classId, file);
      }
      await apiFetch(`/classes/${classId}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          fileId,
        }),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to create assignment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-surface-border2 bg-surface-field p-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="input" />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="input"
      />
      <div className="flex items-center gap-3">
        <label className="text-xs text-ink-muted">
          Due:{" "}
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="ml-1 rounded border border-surface-border2 bg-surface-raised px-2 py-1 text-xs text-ink-2"
          />
        </label>
        <input ref={fileInputRef} type="file" className="text-xs text-ink-muted" />
      </div>
      <button
        onClick={create}
        disabled={busy || !title.trim()}
        className="self-start rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Post assignment"}
      </button>
    </div>
  );
}

function StudentSubmission({ classId, assignmentId }: { classId: string; assignmentId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  // Tracked separately from `submission` itself: a "no submission yet" reply
  // and a "haven't loaded yet" state would otherwise both be indistinguishable
  // falsy/undefined values (Nest sends a bare `null` return as an empty body,
  // which `apiFetch` reads back as `undefined`, same as before the request
  // ever ran) — so "loading" needs its own flag rather than being inferred
  // from `submission`'s value.
  const [loaded, setLoaded] = useState(false);
  const [textContent, setTextContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    apiFetch<Submission | null>(`/classes/${classId}/assignments/${assignmentId}/submissions/me`)
      .then((s) => {
        setSubmission(s ?? null);
        setLoaded(true);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Failed to load your submission");
        setLoaded(true);
      });

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let fileId: string | undefined;
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${formatSize(MAX_UPLOAD_BYTES)})`);
        fileId = await uploadFile(classId, file);
      }
      await apiFetch(`/classes/${classId}/assignments/${assignmentId}/submissions`, {
        method: "POST",
        body: JSON.stringify({ textContent: textContent.trim() || undefined, fileId }),
      });
      setTextContent("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="mt-2 text-xs text-ink-muted">Loading…</p>;

  return (
    <div className="mt-3 border-t border-surface-border2 pt-3">
      {submission && (
        <div className="mb-2 rounded-md bg-surface-field p-2.5 text-xs">
          <p className="text-ink-2">
            {submission.status === "GRADED" ? (
              <>
                <b>Graded: {submission.score} points</b>
                {submission.feedback && <span className="text-ink-muted"> — {submission.feedback}</span>}
              </>
            ) : (
              <span className="text-ink-muted">Submitted {new Date(submission.submittedAt).toLocaleString()}</span>
            )}
          </p>
          {submission.textContent && <p className="mt-1 whitespace-pre-wrap text-ink-3">{submission.textContent}</p>}
          {submission.file && (
            <div className="mt-1">
              <AttachmentLink classId={classId} assignmentId={assignmentId} file={submission.file} />
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <div className="flex flex-col gap-2">
        <textarea
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          placeholder={submission ? "Revise your answer…" : "Your answer…"}
          rows={2}
          className="input text-xs"
        />
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" className="text-xs text-ink-muted" />
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? "Submitting…" : submission ? "Resubmit" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeacherSubmissions({ classId, assignmentId }: { classId: string; assignmentId: string }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { score: string; feedback: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () =>
    apiFetch<Submission[]>(`/classes/${classId}/assignments/${assignmentId}/submissions`).then(setSubmissions);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  async function grade(studentId: string) {
    const draft = drafts[studentId];
    if (!draft || !draft.score) return;
    setBusyId(studentId);
    try {
      await apiFetch(`/classes/${classId}/assignments/${assignmentId}/submissions/${studentId}/grade`, {
        method: "POST",
        body: JSON.stringify({ score: Number(draft.score), feedback: draft.feedback.trim() || undefined }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (!submissions) return <p className="mt-2 text-xs text-ink-muted">Loading…</p>;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-surface-border2 pt-3">
      {submissions.length === 0 && <p className="text-xs text-ink-muted">No submissions yet.</p>}
      {submissions.map((s) => (
        <div key={s.id} className="rounded-md bg-surface-field p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-ink-2">{s.student?.displayName ?? "Student"}</span>
            <span className="text-ink-muted2">{s.status}</span>
          </div>
          {s.textContent && <p className="mt-1 whitespace-pre-wrap text-ink-3">{s.textContent}</p>}
          {s.file && (
            <div className="mt-1">
              <AttachmentLink classId={classId} assignmentId={assignmentId} file={s.file} />
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              placeholder="Score"
              value={drafts[s.studentId]?.score ?? (s.score ?? "")}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [s.studentId]: { score: e.target.value, feedback: d[s.studentId]?.feedback ?? s.feedback ?? "" } }))
              }
              className="w-20 rounded border border-surface-border2 bg-surface-raised px-2 py-1 text-xs text-ink-2"
            />
            <input
              placeholder="Feedback (optional)"
              value={drafts[s.studentId]?.feedback ?? (s.feedback ?? "")}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [s.studentId]: { score: d[s.studentId]?.score ?? String(s.score ?? ""), feedback: e.target.value } }))
              }
              className="flex-1 rounded border border-surface-border2 bg-surface-raised px-2 py-1 text-xs text-ink-2"
            />
            <button
              onClick={() => grade(s.studentId)}
              disabled={busyId === s.studentId}
              className="rounded bg-brand-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {s.status === "GRADED" ? "Update" : "Grade"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
