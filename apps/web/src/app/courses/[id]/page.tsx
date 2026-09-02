"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface Batch {
  id: string;
  title: string;
  subject: string | null;
  createdAt: string;
  _count: { students: number; teachers: number };
}

interface CourseDetail {
  id: string;
  title: string;
  description: string | null;
  createdById: string;
  batches: Batch[];
}

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewBatchForm, setShowNewBatchForm] = useState(false);
  const [batchTitle, setBatchTitle] = useState("");
  const [batchSubject, setBatchSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const isOwner = Boolean(course && user && course.createdById === user.id);

  function refresh() {
    apiFetch<CourseDetail>(`/courses/${params.id}`)
      .then(setCourse)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load course"));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function createBatch() {
    if (!batchTitle.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const klass = await apiFetch<{ id: string }>("/classes", {
        method: "POST",
        body: JSON.stringify({
          title: batchTitle.trim(),
          subject: batchSubject.trim() || undefined,
          courseId: params.id,
        }),
      });
      router.push(`/classes/${klass.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  }

  if (!user) return <FullPageLoading />;

  if (loadError) {
    return (
      <AppShell user={user} active="courses" accessToken={accessToken} onSignOut={() => { clear(); router.push("/"); }}>
        <p className="text-sm text-danger">{loadError}</p>
      </AppShell>
    );
  }
  if (!course) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="courses"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-7">
        <div>
          <Link href="/courses" className="text-sm text-ink-muted hover:text-white">
            ← Courses
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{course.title}</h1>
          {course.description && <p className="mt-1 text-sm text-ink-muted">{course.description}</p>}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
              Batches ({course.batches.length})
            </h2>
            {isOwner && (
              <button
                onClick={() => setShowNewBatchForm((v) => !v)}
                className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
              >
                {showNewBatchForm ? "Cancel" : "+ New batch"}
              </button>
            )}
          </div>

          {showNewBatchForm && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-surface-border2 bg-surface-field p-3">
              <div className="flex gap-2">
                <input
                  value={batchTitle}
                  onChange={(e) => setBatchTitle(e.target.value)}
                  placeholder="Batch title (e.g. Morning cohort — Jan 2026)"
                  className="input"
                />
                <input
                  value={batchSubject}
                  onChange={(e) => setBatchSubject(e.target.value)}
                  placeholder="Subject (optional)"
                  className="input"
                />
              </div>
              <button
                onClick={createBatch}
                disabled={creating || !batchTitle.trim()}
                className="self-start rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create batch"}
              </button>
              {createError && <p className="text-xs text-danger">{createError}</p>}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {course.batches.length === 0 && (
              <li className="text-sm text-ink-muted">
                No batches yet.{isOwner ? " Create one to start teaching this course." : ""}
              </li>
            )}
            {course.batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/classes/${b.id}`}
                  className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition hover:border-brand-500"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{b.title}</p>
                    {b.subject && <p className="mt-0.5 text-xs text-ink-muted">{b.subject}</p>}
                  </div>
                  <span className="flex-none text-xs text-ink-muted">
                    {b._count.teachers} teacher{b._count.teachers === 1 ? "" : "s"} ·{" "}
                    {b._count.students} student{b._count.students === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
