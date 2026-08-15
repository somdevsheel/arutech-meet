"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

/** Live clock + today's meetings + a real (not simulated) camera/mic permission
 * check via the Permissions API — no fabricated device names or fake "connected"
 * state, just what the browser actually reports. */
export function TodayRail({ meetings }: { meetings: Meeting[] }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const todaysMeetings = meetings
    .filter((m) => {
      if (m.status === "LIVE") return true;
      if (!m.scheduledStart) return false;
      const d = new Date(m.scheduledStart);
      const today = now ?? new Date();
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    })
    .sort((a, b) => {
      if (a.status === "LIVE" && b.status !== "LIVE") return -1;
      if (b.status === "LIVE" && a.status !== "LIVE") return 1;
      return new Date(a.scheduledStart ?? 0).getTime() - new Date(b.scheduledStart ?? 0).getTime();
    });

  return (
    <>
      <div>
        <time className="block text-3xl font-semibold tracking-tight">
          {now
            ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
            : " "}
        </time>
        <p className="mt-0.5 text-xs text-ink-muted">
          {now?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? " "}
        </p>
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Today</h2>
          <span className="text-[10px] font-medium text-ink-muted">
            {todaysMeetings.length} meeting{todaysMeetings.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {todaysMeetings.length === 0 && (
            <p className="text-xs text-ink-muted">Nothing scheduled for today.</p>
          )}
          {todaysMeetings.map((m) => {
            const live = m.status === "LIVE";
            return (
              <article
                key={m.id}
                className={`flex items-center gap-2.5 rounded-lg border p-3 ${
                  live ? "border-brand-500 bg-brand-tint" : "border-transparent bg-surface-elevated"
                }`}
              >
                <span className={`min-h-[42px] w-[3px] flex-none self-stretch rounded-full ${live ? "bg-brand-500" : "bg-surface-border2"}`} />
                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-1.5 text-[10px] font-medium ${live ? "text-brand-300" : "text-ink-muted"}`}>
                    {m.scheduledStart &&
                      new Date(m.scheduledStart).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {live && (
                      <span className="rounded-full bg-danger px-1.5 py-0.5 text-[8px] font-semibold text-white">
                        LIVE
                      </span>
                    )}
                  </div>
                  <h3 className="my-0.5 truncate text-xs font-semibold">{m.title}</h3>
                </div>
                <button
                  onClick={() => router.push(`/meeting/${m.code}`)}
                  className={`flex-none rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                    live ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-surface-chip text-ink-3 hover:brightness-110"
                  }`}
                >
                  Join
                </button>
              </article>
            );
          })}
        </div>
      </div>

      <DevicesCard />
    </>
  );
}

type PermState = "unknown" | "granted" | "denied" | "prompt";

function DevicesCard() {
  const [state, setState] = useState<PermState>("unknown");
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      // Permissions API coverage for 'camera'/'microphone' is Chromium-only and
      // best-effort; when unsupported we fall back to a real getUserMedia probe
      // (immediately stopping the tracks) rather than guessing.
      const nav = navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: PermState }> } };
      if (nav.permissions?.query) {
        const [cam, mic] = await Promise.all([
          nav.permissions.query({ name: "camera" }).catch(() => null),
          nav.permissions.query({ name: "microphone" }).catch(() => null),
        ]);
        if (cam && mic) {
          const worst = [cam.state, mic.state].includes("denied")
            ? "denied"
            : [cam.state, mic.state].includes("prompt")
              ? "prompt"
              : "granted";
          setState(worst as PermState);
          setChecking(false);
          return;
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      setState("granted");
    } catch {
      setState("denied");
    } finally {
      setChecking(false);
    }
  }

  const dotClass = state === "granted" ? "bg-success" : state === "denied" ? "bg-danger" : "bg-ink-muted2";
  const label =
    state === "granted"
      ? "Camera and microphone ready"
      : state === "denied"
        ? "Camera or microphone blocked"
        : state === "prompt"
          ? "Permission not granted yet"
          : "Not checked yet";

  return (
    <div className="mt-auto rounded-lg bg-surface-elevated p-3.5">
      <h3 className="mb-2 text-xs font-semibold">Audio and video</h3>
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <span className={`h-2 w-2 flex-none rounded-full ${dotClass}`} />
        {label}
      </div>
      <button
        onClick={check}
        disabled={checking}
        className="mt-2 w-full rounded-md bg-surface-chip py-2 text-[11px] font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
      >
        {checking ? "Checking…" : "Check camera & microphone"}
      </button>
    </div>
  );
}
