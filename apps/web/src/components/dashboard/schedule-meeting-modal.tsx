"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Toggle } from "./personal-room-settings-modal";

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

/** Real scheduling, not a placeholder form: posts type: "SCHEDULED" with
 * scheduledStart/scheduledEnd to the same POST /meetings the instant-meeting
 * flow uses (packages/validation's createMeetingSchema already supports this;
 * the dashboard just never exposed it in the UI before). */
export function ScheduleMeetingModal({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: (meeting: Meeting) => void;
}) {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + 30, 0, 0);
  const defaultStart = now.toISOString().slice(0, 16);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState(30);
  // H-4: waitingRoomEnabled defaults to true server-side, but this modal
  // never surfaced that at all — a host scheduling a meeting had no way to
  // know or change it before sharing the invite, and attendees who arrived
  // on time were stuck waiting with no explanation. Defaults to true here
  // too (unchanged behavior for anyone who doesn't touch it), but now it's
  // an actual, visible choice instead of an invisible one.
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const scheduledStart = new Date(start);
      const scheduledEnd = new Date(scheduledStart.getTime() + duration * 60_000);
      const meeting = await apiFetch<Meeting>("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: title || "Scheduled meeting",
          type: "SCHEDULED",
          scheduledStart: scheduledStart.toISOString(),
          scheduledEnd: scheduledEnd.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          settings: { waitingRoomEnabled },
        }),
      });
      onScheduled(meeting);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to schedule meeting");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Schedule a meeting">
      <div className="flex flex-col gap-4">
        <Field label="Topic">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly sync"
            className="input"
            autoFocus
          />
        </Field>
        <Field label="Start">
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Duration">
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="input"
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
        </Field>

        <Toggle
          label="Waiting room"
          description="Attendees wait for you to admit them before joining"
          checked={waitingRoomEnabled}
          onChange={setWaitingRoomEnabled}
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-surface-border/50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-surface-border bg-surface-raised p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-surface-border/50 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
