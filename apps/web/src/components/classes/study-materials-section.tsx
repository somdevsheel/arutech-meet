"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

interface StudyMaterialSummary {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  title: string;
  createdAt: string;
  publishedAt: string | null;
}

interface Flashcard {
  front: string;
  back: string;
}

interface PracticeQuestion {
  question: string;
  options: { text: string; isCorrect: boolean }[];
}

interface StudyMaterialDetail extends StudyMaterialSummary {
  lectureNotes: string;
  studyGuide: string;
  flashcards: Flashcard[];
  practiceQuestions: PracticeQuestion[];
}

interface EligibleTranscript {
  transcriptId: string;
  session: { id: string; title: string | null; sessionDate: string } | null;
  readyAt: string | null;
}

type Tab = "notes" | "guide" | "flashcards" | "practice";

export function StudyMaterialsSection({ classId, isTeacher }: { classId: string; isTeacher: boolean }) {
  const [materials, setMaterials] = useState<StudyMaterialSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    apiFetch<StudyMaterialSummary[]>(`/classes/${classId}/study-materials`).then(setMaterials);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          Study Materials <span className="normal-case text-ink-muted2">— AI classroom assistant</span>
        </h2>
        {isTeacher && (
          <button
            onClick={() => setShowGenerateForm((v) => !v)}
            className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          >
            {showGenerateForm ? "Cancel" : "+ Generate from a session"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {showGenerateForm && (
        <GenerateForm
          classId={classId}
          onGenerated={() => {
            setShowGenerateForm(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      <ul className="flex flex-col gap-2">
        {materials?.length === 0 && (
          <li className="text-sm text-ink-muted">
            No study materials yet.{isTeacher ? " Generate one from a session with a ready transcript." : ""}
          </li>
        )}
        {materials?.map((m) => (
          <li key={m.id} className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{m.title}</p>
                <p className="mt-1 text-[11px] text-ink-muted2">
                  {m.status === "PUBLISHED" ? (
                    <span className="text-success">Published</span>
                  ) : (
                    <span className="text-warn">Draft — not visible to students</span>
                  )}
                  {" · "}
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setExpandedId((cur) => (cur === m.id ? null : m.id))}
                className="flex-none text-xs text-brand-300 hover:underline"
              >
                {expandedId === m.id ? "Hide" : "View"}
              </button>
            </div>

            {expandedId === m.id && (
              <StudyMaterialDetailView
                classId={classId}
                materialId={m.id}
                isTeacher={isTeacher}
                onChanged={refresh}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GenerateForm({
  classId,
  onGenerated,
  onError,
}: {
  classId: string;
  onGenerated: () => void;
  onError: (msg: string | null) => void;
}) {
  const [transcripts, setTranscripts] = useState<EligibleTranscript[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    apiFetch<EligibleTranscript[]>(`/classes/${classId}/study-materials/eligible-transcripts`).then(setTranscripts);
  }, [classId]);

  async function generate() {
    if (!selectedId) return;
    setGenerating(true);
    onError(null);
    try {
      await apiFetch(`/classes/${classId}/study-materials`, {
        method: "POST",
        body: JSON.stringify({ transcriptId: selectedId }),
      });
      onGenerated();
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to generate study material",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-surface-border2 bg-surface-field p-3">
      {transcripts === null && <p className="text-xs text-ink-muted">Loading sessions…</p>}
      {transcripts?.length === 0 && (
        <p className="text-xs text-ink-muted">
          No session has a ready transcript yet. Generate one from a session&apos;s Record tab first (start a
          recording, then &quot;Generate transcript &amp; AI summary&quot;).
        </p>
      )}
      {transcripts && transcripts.length > 0 && (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-lg border border-surface-border2 bg-surface-raised px-2.5 py-2 text-xs text-ink-2"
          >
            <option value="">Pick a session…</option>
            {transcripts.map((t) => (
              <option key={t.transcriptId} value={t.transcriptId}>
                {t.session?.title ?? "Session"} —{" "}
                {t.session ? new Date(t.session.sessionDate).toLocaleDateString() : ""}
              </option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={generating || !selectedId}
            className="self-start rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </>
      )}
    </div>
  );
}

function StudyMaterialDetailView({
  classId,
  materialId,
  isTeacher,
  onChanged,
}: {
  classId: string;
  materialId: string;
  isTeacher: boolean;
  onChanged: () => void;
}) {
  const [material, setMaterial] = useState<StudyMaterialDetail | null>(null);
  const [tab, setTab] = useState<Tab>("notes");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<StudyMaterialDetail>(`/classes/${classId}/study-materials/${materialId}`).then(setMaterial);
  }, [classId, materialId]);

  async function publish() {
    setBusy(true);
    try {
      await apiFetch(`/classes/${classId}/study-materials/${materialId}/publish`, { method: "POST" });
      const refreshed = await apiFetch<StudyMaterialDetail>(`/classes/${classId}/study-materials/${materialId}`);
      setMaterial(refreshed);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/classes/${classId}/study-materials/${materialId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!material) return <p className="mt-2 text-xs text-ink-muted">Loading…</p>;

  const TABS: { key: Tab; label: string }[] = [
    { key: "notes", label: "Lecture Notes" },
    { key: "guide", label: "Study Guide" },
    { key: "flashcards", label: `Flashcards (${material.flashcards.length})` },
    { key: "practice", label: `Practice (${material.practiceQuestions.length})` },
  ];

  return (
    <div className="mt-3 border-t border-surface-border2 pt-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded px-2 py-1 text-[11px] font-medium ${
              tab === t.key ? "bg-brand-500 text-white" : "bg-surface-field text-ink-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "notes" && (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-3">{material.lectureNotes}</p>
      )}
      {tab === "guide" && (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-3">{material.studyGuide}</p>
      )}
      {tab === "flashcards" && (
        <div className="flex flex-col gap-2">
          {material.flashcards.map((f, i) => (
            <div key={i} className="rounded-md bg-surface-field p-2.5 text-xs">
              <p className="font-medium text-ink-2">{f.front}</p>
              <p className="mt-1 text-ink-muted">{f.back}</p>
            </div>
          ))}
        </div>
      )}
      {tab === "practice" && (
        <div className="flex flex-col gap-3">
          {material.practiceQuestions.map((q, i) => (
            <div key={i} className="rounded-md bg-surface-field p-2.5 text-xs">
              <p className="font-medium text-ink-2">{q.question}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {q.options.map((o, oi) => (
                  <li
                    key={oi}
                    className={o.isCorrect ? "text-success" : "text-ink-muted"}
                  >
                    {o.isCorrect ? "✓ " : "· "}
                    {o.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {isTeacher && (
        <div className="mt-3 flex gap-2">
          {material.status === "DRAFT" && (
            <button
              onClick={publish}
              disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Publish to students
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
