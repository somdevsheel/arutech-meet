"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { AssignmentsSection } from "@/components/classes/assignments-section";
import { StudyMaterialsSection } from "@/components/classes/study-materials-section";

interface ClassDetail {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  ownerTeacherId: string;
  teachers: { userId: string; user: { displayName: string; avatarUrl: string | null } }[];
  students: { userId: string; user: { displayName: string; avatarUrl: string | null } }[];
  course: { id: string; title: string } | null;
}

interface ClassSession {
  id: string;
  sessionDate: string;
  title: string | null;
  meeting: { id: string; code: string; status: string };
}

export default function ClassDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();
  const [klass, setKlass] = useState<ClassDetail | null>(null);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [studentEmail, setStudentEmail] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [startingSession, setStartingSession] = useState(false);

  const isTeacher = Boolean(klass?.teachers.some((t) => t.userId === user?.id));

  useEffect(() => {
    apiFetch<ClassDetail>(`/classes/${params.id}`).then(setKlass);
    apiFetch<ClassSession[]>(`/classes/${params.id}/sessions`).then(setSessions);
  }, [params.id]);

  async function enrollStudent() {
    setEnrollError(null);
    try {
      const found = await apiFetch<{ id: string }>(`/users/by-email/${encodeURIComponent(studentEmail)}`);
      await apiFetch(`/classes/${params.id}/students`, {
        method: "POST",
        body: JSON.stringify({ userId: found.id }),
      });
      const refreshed = await apiFetch<ClassDetail>(`/classes/${params.id}`);
      setKlass(refreshed);
      setStudentEmail("");
    } catch (err) {
      setEnrollError(err instanceof ApiError ? err.message : "Failed to enroll student");
    }
  }

  async function startSession() {
    setStartingSession(true);
    try {
      const session = await apiFetch<ClassSession>(`/classes/${params.id}/sessions`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      router.push(`/meeting/${session.meeting.code}`);
    } finally {
      setStartingSession(false);
    }
  }

  if (!user || !klass) return null;

  return (
    <AppShell
      user={user}
      active="classes"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-7">
        <div>
          <Link href="/classes" className="text-sm text-ink-muted hover:text-white">
            ← Classes
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{klass.title}</h1>
          {klass.subject && <p className="text-sm text-ink-muted">{klass.subject}</p>}
          {klass.course && (
            <Link href={`/courses/${klass.course.id}`} className="mt-1 inline-block text-xs text-brand-300 hover:underline">
              Part of {klass.course.title}
            </Link>
          )}
        </div>

        {isTeacher && (
          <button
            onClick={startSession}
            disabled={startingSession}
            className="self-start rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {startingSession ? "Starting…" : "Start a class session"}
          </button>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-muted">
            Students ({klass.students.length})
          </h2>
          {isTeacher && (
            <div className="mb-3 flex gap-2">
              <input
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                placeholder="Student email"
                className="input"
              />
              <button
                onClick={enrollStudent}
                className="whitespace-nowrap rounded-lg bg-surface-chip px-4 py-2.5 text-sm font-medium text-white hover:brightness-110"
              >
                Enroll
              </button>
            </div>
          )}
          {enrollError && <p className="mb-2 text-sm text-danger">{enrollError}</p>}
          <ul className="flex flex-col gap-1">
            {klass.students.map((s) => (
              <li key={s.userId} className="text-sm text-ink-3">
                {s.user.displayName}
              </li>
            ))}
            {klass.students.length === 0 && <li className="text-sm text-ink-muted">No students enrolled yet.</li>}
          </ul>
        </section>

        <AssignmentsSection classId={params.id} isTeacher={isTeacher} />

        <StudyMaterialsSection classId={params.id} isTeacher={isTeacher} />

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-muted">Sessions</h2>
          <ul className="flex flex-col gap-2">
            {sessions.length === 0 && <li className="text-sm text-ink-muted">No sessions yet.</li>}
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3"
              >
                <div>
                  <p className="text-sm text-white">{new Date(s.sessionDate).toLocaleString()}</p>
                  <p className="text-xs text-ink-muted">{s.meeting.status}</p>
                </div>
                <div className="flex gap-3 text-xs">
                  {s.meeting.status === "LIVE" && (
                    <Link href={`/meeting/${s.meeting.code}`} className="text-brand-300">
                      Join
                    </Link>
                  )}
                  {isTeacher && (
                    <Link href={`/classes/${params.id}/sessions/${s.id}/attendance`} className="text-brand-300">
                      Attendance
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
