"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { ScheduleMeetingModal } from "@/components/dashboard/schedule-meeting-modal";
import { JoinMeetingModal } from "@/components/dashboard/join-meeting-modal";
import { TodayRail } from "@/components/dashboard/today-rail";
import { RecordingsRow } from "@/components/dashboard/recordings-row";
import { PersonalRoomSettingsModal } from "@/components/dashboard/personal-room-settings-modal";
import { FullPageLoading } from "@/components/full-page-loading";

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  settings?: {
    waitingRoomEnabled: boolean;
    allowChat: boolean;
    allowRecording: boolean;
    allowedEmailDomains: string[];
  } | null;
}

function greeting(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hosting, setHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"schedule" | "join" | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [personalRoom, setPersonalRoom] = useState<Meeting | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  useEffect(() => {
    // Wait for the persisted session to actually load from localStorage before
    // deciding the user is logged out — on a fresh page load/refresh this store
    // starts empty and only hydrates asynchronously (see auth-store.ts). Bailing
    // out here on the first render would otherwise bounce a genuinely logged-in
    // user to /login every time they reload this page.
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refresh();
    apiFetch<Meeting>("/meetings/personal").then(setPersonalRoom).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken]);

  async function refresh() {
    try {
      const data = await apiFetch<Meeting[]>("/meetings");
      setMeetings(data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setLoaded(true);
    }
  }

  async function hostNow() {
    setHosting(true);
    setError(null);
    try {
      // H-4: waitingRoomEnabled defaults to true server-side, which is the
      // right default for a scheduled meeting shared in advance, but wrong
      // for "New meeting" — the entire point of this one-click flow is
      // sharing the link and having people join immediately. There's no
      // settings step here to ever surface (or turn off) that gate before
      // sharing, so anyone the host sent the link to right after clicking
      // this landed in the waiting room with no explanation, and the host
      // had no idea anything was different. Instant meetings opt out of it
      // explicitly instead. (There's genuinely no way to turn it back on for
      // an already-created meeting from the UI yet — the in-meeting Info
      // panel's "Waiting room" row is read-only, same gap H-11 flags for
      // the password setting; that's a separate, bigger fix.)
      const meeting = await apiFetch<Meeting>("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: "Instant meeting",
          type: "INSTANT",
          settings: { waitingRoomEnabled: false },
        }),
      });
      router.push(`/meeting/${meeting.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start meeting");
      setHosting(false);
    }
  }

  if (!user) return <FullPageLoading />;

  const now = Date.now();
  const upcoming = meetings
    .filter((m) => m.status === "SCHEDULED" && m.scheduledStart && new Date(m.scheduledStart).getTime() > now)
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());
  const recent = meetings.filter((m) => !upcoming.includes(m));
  const firstName = user.displayName.split(" ")[0];

  return (
    <AppShell
      user={user}
      active="home"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
      rail={<TodayRail meetings={meetings} />}
    >
      <div className="flex flex-col gap-7">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            {hour !== null ? greeting(hour) : "Welcome"}, {firstName}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            @{user.username} · {upcoming.length} upcoming meeting{upcoming.length === 1 ? "" : "s"}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Quick actions">
          <ActionCard
            tone="warn"
            title={hosting ? "Starting…" : "New meeting"}
            description="Start an instant meeting"
            onClick={hostNow}
            disabled={hosting}
            icon={
              <>
                <rect x="3" y="6" width="12" height="12" rx="2" />
                <path d="m15 11 6-4v10l-6-4" />
              </>
            }
          />
          <ActionCard
            tone="brand"
            title="Join"
            description="Enter a meeting code"
            onClick={() => setModal("join")}
            icon={
              <>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <path d="M10 17l5-5-5-5M15 12H3" />
              </>
            }
          />
          <ActionCard
            tone="success"
            title="Schedule"
            description="Plan a meeting for later"
            onClick={() => setModal("schedule")}
            icon={
              <>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </>
            }
          />
        </section>

        {error && <p className="text-sm text-danger">{error}</p>}

        {personalRoom && (
          <section className="flex items-center gap-4 rounded-xl border border-surface-border bg-surface-raised px-5 py-4">
            <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg bg-brand-tint2 text-brand-300">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="3.4" />
                <path d="M5 20a7 7 0 0 1 14 0" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">My personal meeting room</h3>
              <p className="mt-0.5 text-xs text-ink-muted">Code: {personalRoom.code} — always the same link</p>
            </div>
            <button
              onClick={() => setShowRoomSettings(true)}
              aria-label="Personal room settings"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-muted hover:bg-surface-field hover:text-ink-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" />
              </svg>
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/meeting/${personalRoom.code}`);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              className="flex-none rounded-lg border border-surface-border2 bg-surface-field px-4 py-2 text-xs font-medium text-ink-3 hover:brightness-110"
            >
              {linkCopied ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={() => router.push(`/meeting/${personalRoom.code}`)}
              className="flex-none rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600"
            >
              Start
            </button>
          </section>
        )}

        {showRoomSettings && personalRoom?.settings && (
          <PersonalRoomSettingsModal
            meetingId={personalRoom.id}
            initial={personalRoom.settings}
            onClose={() => setShowRoomSettings(false)}
            onSaved={(settings) => {
              setPersonalRoom((prev) => (prev ? { ...prev, settings } : prev));
              setShowRoomSettings(false);
            }}
          />
        )}

        <RecordingsRow />

        <section>
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Upcoming meetings</h2>
          </div>
          {loaded && upcoming.length === 0 && (
            <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-ink-muted">
              No upcoming meetings — schedule one above.
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <MeetingRow key={m.id} meeting={m} />
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3.5 text-[15px] font-semibold">Recent meetings</h2>
          {loaded && recent.length === 0 && (
            <p className="text-xs text-ink-muted">No meetings yet — host or schedule one above.</p>
          )}
          <ul className="flex flex-col gap-2">
            {recent.map((m) => (
              <MeetingRow key={m.id} meeting={m} />
            ))}
          </ul>
        </section>
      </div>

      {modal === "schedule" && (
        <ScheduleMeetingModal
          onClose={() => setModal(null)}
          onScheduled={(meeting) => {
            setMeetings((prev) => [meeting, ...prev]);
            setModal(null);
          }}
        />
      )}
      {modal === "join" && <JoinMeetingModal onClose={() => setModal(null)} />}
    </AppShell>
  );
}

function ActionCard({
  tone,
  title,
  description,
  onClick,
  disabled,
  icon,
}: {
  tone: "warn" | "brand" | "success";
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
}) {
  const toneClasses = {
    warn: "bg-warn-bg text-warn",
    brand: "bg-brand-tint text-brand-300",
    success: "bg-success-bg text-success",
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-3 rounded-xl border border-surface-border bg-surface-raised p-[18px] text-left transition hover:-translate-y-0.5 hover:border-surface-border2 disabled:opacity-50"
    >
      <span className={`grid h-[42px] w-[42px] place-items-center rounded-lg ${toneClasses}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {icon}
        </svg>
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] text-ink-muted">{description}</span>
      </span>
    </button>
  );
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
  return (
    <li>
      <Link
        href={`/meeting/${meeting.code}`}
        className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition hover:border-brand-500"
      >
        <div>
          <p className="text-sm font-medium text-white">{meeting.title}</p>
          <p className="text-xs text-ink-muted">
            {meeting.code}
            {meeting.type !== meeting.status && ` · ${meeting.type}`} · {meeting.status}
            {meeting.scheduledStart && (
              <>
                {" · "}
                {new Date(meeting.scheduledStart).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}
