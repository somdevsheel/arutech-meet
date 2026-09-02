"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { loginRedirectUrl } from "@/lib/login-redirect";
import type { CalendarEvent } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

type ViewMode = "month" | "week" | "day";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d: Date) {
  return d.toDateString();
}

/** [from, to) for whatever the API should be asked for — always wide enough
 * to cover the full grid a view renders (month view pads to whole weeks
 * either side of the month), not just the exact visible range. */
function rangeFor(view: ViewMode, cursor: Date): [Date, Date] {
  if (view === "day") {
    const from = startOfDay(cursor);
    return [from, addDays(from, 1)];
  }
  if (view === "week") {
    const from = startOfWeek(cursor);
    return [from, addDays(from, 7)];
  }
  const gridStart = startOfWeek(startOfMonth(cursor));
  return [gridStart, addDays(gridStart, 42)];
}

function eventTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Day/week/month views over real scheduled meetings and class sessions —
 * `GET /calendar/events` (see CalendarService), not a client-side re-derive
 * of `/meetings`. Class sessions are scheduled via their own `sessionDate`,
 * distinct from a meeting's `scheduledStart`; a RECURRING meeting is one
 * stored rule the server projects into individual occurrence dates for
 * display — every occurrence still opens the exact same meeting room. */
export default function CalendarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<"google" | "outlook" | null>(null);

  useEffect(() => {
    setCursor(new Date());
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace(loginRedirectUrl(pathname));
    }
  }, [hasHydrated, accessToken, router, pathname]);

  useEffect(() => {
    if (!cursor || !accessToken) return;
    const [from, to] = rangeFor(view, cursor);
    setError(null);
    apiFetch<CalendarEvent[]>(`/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load your calendar"));
  }, [view, cursor, accessToken]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const key = dayKey(new Date(e.start));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [events]);

  function openEvent(e: CalendarEvent) {
    router.push(`/meeting/${e.meetingCode}`);
  }

  async function connect(provider: "google" | "outlook") {
    setConnecting(provider);
    setConnectError(null);
    try {
      await apiFetch(`/calendar/connect/${provider}`, { method: "POST" });
    } catch (err) {
      setConnectError(err instanceof ApiError ? err.message : "Failed to connect");
    } finally {
      setConnecting(null);
    }
  }

  if (!user || !cursor) return <FullPageLoading />;

  const label =
    view === "day"
      ? cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : view === "week"
        ? `${startOfWeek(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(startOfWeek(cursor), 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
        : cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function step(dir: -1 | 1) {
    if (!cursor) return;
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
  }

  return (
    <AppShell
      user={user}
      active="calendar"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="mt-1 text-[13px] text-ink-muted">Your scheduled meetings and class sessions.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-surface-chip p-0.5">
              {(["month", "week", "day"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                    view === v ? "bg-brand-500 text-white" : "text-ink-3 hover:text-white"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => step(-1)}
              aria-label="Previous"
              className="grid h-8 w-8 place-items-center rounded-lg bg-surface-chip text-ink-3 hover:brightness-110"
            >
              ‹
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
            >
              Today
            </button>
            <button
              onClick={() => step(1)}
              aria-label="Next"
              className="grid h-8 w-8 place-items-center rounded-lg bg-surface-chip text-ink-3 hover:brightness-110"
            >
              ›
            </button>
          </div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <span className="w-[132px]" aria-hidden />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {view === "month" && <MonthGrid cursor={cursor} byDay={byDay} onOpenEvent={openEvent} onOpenDay={(d) => { setCursor(d); setView("day"); }} />}
        {view === "week" && <WeekView cursor={cursor} byDay={byDay} onOpenEvent={openEvent} />}
        {view === "day" && <DayView cursor={cursor} byDay={byDay} onOpenEvent={openEvent} />}

        <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
          <h3 className="text-sm font-semibold">External calendar sync</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Google/Outlook sync isn&rsquo;t configured on this server yet — these buttons hit a real endpoint, not
            a placeholder, and will start working once a real OAuth integration is added.
          </p>
          {connectError && <p className="mt-2 text-xs text-danger">{connectError}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => connect("google")}
              disabled={connecting !== null}
              className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
            >
              {connecting === "google" ? "Connecting…" : "Connect Google Calendar"}
            </button>
            <button
              onClick={() => connect("outlook")}
              disabled={connecting !== null}
              className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
            >
              {connecting === "outlook" ? "Connecting…" : "Connect Outlook Calendar"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function EventPill({ event, compact, onOpen }: { event: CalendarEvent; compact?: boolean; onOpen: (e: CalendarEvent) => void }) {
  const isClass = event.kind === "CLASS";
  return (
    <button
      onClick={() => onOpen(event)}
      className={`flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[10px] font-medium hover:brightness-110 ${
        isClass ? "bg-warn/20 text-warn" : "bg-brand-tint2 text-brand-300"
      } ${compact ? "" : "text-xs py-1.5"}`}
      title={event.title}
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${isClass ? "bg-warn" : "bg-brand-500"}`} />
      <span className="flex-none text-ink-muted">{eventTime(event.start)}</span>
      <span className="truncate">{event.title}</span>
    </button>
  );
}

function MonthGrid({
  cursor,
  byDay,
  onOpenEvent,
  onOpenDay,
}: {
  cursor: Date;
  byDay: Map<string, CalendarEvent[]>;
  onOpenEvent: (e: CalendarEvent) => void;
  onOpenDay: (d: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const today = new Date();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdayLabels = cells.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: "short" }));

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <div className="grid grid-cols-7 border-b border-surface-border bg-surface-sunken">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const dayEvents = (byDay.get(dayKey(d)) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
          const shown = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - shown.length;
          return (
            <div
              key={d.toISOString()}
              aria-current={isToday ? "date" : undefined}
              className={`flex min-h-[104px] flex-col gap-1 border-b border-r border-surface-border p-1.5 last:border-r-0 ${
                inMonth ? "" : "bg-surface-sunken/40"
              }`}
            >
              <button
                onClick={() => onOpenDay(d)}
                className={`self-start rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                  isToday ? "bg-brand-500 text-white" : inMonth ? "text-ink-2" : "text-ink-muted2"
                }`}
              >
                {d.getDate()}
              </button>
              <div className="flex flex-col gap-0.5">
                {shown.map((e) => (
                  <EventPill key={e.id} event={e} compact onOpen={onOpenEvent} />
                ))}
                {overflow > 0 && (
                  <button onClick={() => onOpenDay(d)} className="px-1.5 text-left text-[10px] text-ink-muted hover:text-white">
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  cursor,
  byDay,
  onOpenEvent,
}: {
  cursor: Date;
  byDay: Map<string, CalendarEvent[]>;
  onOpenEvent: (e: CalendarEvent) => void;
}) {
  const start = startOfWeek(cursor);
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const isToday = sameDay(d, today);
        const dayEvents = (byDay.get(dayKey(d)) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
        return (
          <div
            key={d.toISOString()}
            aria-current={isToday ? "date" : undefined}
            className="flex min-h-[220px] flex-col gap-1.5 rounded-xl border border-surface-border p-2.5"
          >
            <div className={`text-center ${isToday ? "text-brand-300" : "text-ink-muted"}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide">{d.toLocaleDateString(undefined, { weekday: "short" })}</p>
              <p className={`text-sm font-semibold ${isToday ? "text-white" : "text-ink-2"}`}>{d.getDate()}</p>
            </div>
            <div className="flex flex-col gap-1">
              {dayEvents.length === 0 && <p className="text-center text-[10px] text-ink-faint">—</p>}
              {dayEvents.map((e) => (
                <EventPill key={e.id} event={e} onOpen={onOpenEvent} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  cursor,
  byDay,
  onOpenEvent,
}: {
  cursor: Date;
  byDay: Map<string, CalendarEvent[]>;
  onOpenEvent: (e: CalendarEvent) => void;
}) {
  const dayEvents = (byDay.get(dayKey(cursor)) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="rounded-xl border border-surface-border p-4">
      {dayEvents.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">Nothing scheduled for this day.</p>}
      <div className="flex flex-col gap-2">
        {dayEvents.map((e) => (
          <button
            key={e.id}
            onClick={() => onOpenEvent(e)}
            className="flex items-center gap-3 rounded-lg border border-surface-border2 bg-surface-elevated p-3 text-left hover:border-brand-500"
          >
            <span className={`h-full min-h-[36px] w-[3px] flex-none self-stretch rounded-full ${e.kind === "CLASS" ? "bg-warn" : "bg-brand-500"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-muted">
                {eventTime(e.start)}
                {e.end && <span>– {eventTime(e.end)}</span>}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    e.kind === "CLASS" ? "bg-warn/20 text-warn" : "bg-brand-tint2 text-brand-300"
                  }`}
                >
                  {e.kind === "CLASS" ? e.className ?? "Class" : "Meeting"}
                </span>
                {e.isRecurringOccurrence && <span>· recurring</span>}
              </div>
              <h3 className="my-0.5 truncate text-sm font-semibold">{e.title}</h3>
            </div>
            <span className="flex-none rounded-md bg-brand-500 px-3 py-1.5 text-[11px] font-semibold text-white">Join</span>
          </button>
        ))}
      </div>
    </div>
  );
}
