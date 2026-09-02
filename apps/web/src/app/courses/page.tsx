"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  _count: { batches: number };
}

export default function CoursesPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<CourseSummary[]>("/courses").then(setCourses);
  }, [hasHydrated, accessToken, router]);

  async function createCourse() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const course = await apiFetch<CourseSummary>("/courses", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      router.push(`/courses/${course.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create course");
    } finally {
      setCreating(false);
    }
  }

  if (!user) return <FullPageLoading />;

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
          <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            A course groups however many times you actually teach it — each batch underneath is a full
            class of its own (own roster, own sessions, own assignments).
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-5">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Course title (e.g. Introduction to Biology)"
              className="input"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="input"
            />
          </div>
          <button
            onClick={createCourse}
            disabled={creating || !title.trim()}
            className="self-start rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create course"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <ul className="flex flex-col gap-2">
          {courses.length === 0 && (
            <li className="text-sm text-ink-muted">
              No courses yet. A course is optional — a class works fine on its own too.
            </li>
          )}
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                href={`/courses/${c.id}`}
                className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition hover:border-brand-500"
              >
                <div>
                  <p className="text-sm font-medium text-white">{c.title}</p>
                  {c.description && <p className="mt-0.5 text-xs text-ink-muted">{c.description}</p>}
                </div>
                <span className="flex-none text-xs text-ink-muted">
                  {c._count.batches} batch{c._count.batches === 1 ? "" : "es"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
