"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface ClassDetail {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  ownerTeacherId: string;
  teachers: { userId: string; user: { displayName: string; avatarUrl: string | null } }[];
  students: { userId: string; user: { displayName: string; avatarUrl: string | null } }[];
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
  const user = useAuthStore((s) => s.user);
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

  if (!klass) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/classes" className="text-sm text-slate-400 hover:text-white">
        ← Classes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-white">{klass.title}</h1>
      {klass.subject && <p className="text-sm text-slate-500">{klass.subject}</p>}

      {isTeacher && (
        <button
          onClick={startSession}
          disabled={startingSession}
          className="mt-4 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {startingSession ? "Starting…" : "Start a class session"}
        </button>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
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
              className="whitespace-nowrap rounded-lg bg-surface-border px-4 py-2.5 text-sm font-medium text-white"
            >
              Enroll
            </button>
          </div>
        )}
        {enrollError && <p className="mb-2 text-sm text-red-400">{enrollError}</p>}
        <ul className="space-y-1">
          {klass.students.map((s) => (
            <li key={s.userId} className="text-sm text-slate-300">
              {s.user.displayName}
            </li>
          ))}
          {klass.students.length === 0 && <li className="text-sm text-slate-500">No students enrolled yet.</li>}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Sessions</h2>
        <ul className="space-y-2">
          {sessions.length === 0 && <li className="text-sm text-slate-500">No sessions yet.</li>}
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3"
            >
              <div>
                <p className="text-sm text-white">{new Date(s.sessionDate).toLocaleString()}</p>
                <p className="text-xs text-slate-500">{s.meeting.status}</p>
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
    </main>
  );
}
