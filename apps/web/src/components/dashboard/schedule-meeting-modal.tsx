"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Toggle, MeetingPasswordField } from "./personal-room-settings-modal";

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  requiresPassword?: boolean;
  ownerId?: string;
  settings?: {
    waitingRoomEnabled: boolean;
    allowChat: boolean;
    allowRecording: boolean;
    allowedEmailDomains: string[];
  } | null;
}

const PRESET_DURATIONS = [15, 30, 45, 60, 90, 120];

function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Real scheduling, not a placeholder form: posts type: "SCHEDULED" with
 * scheduledStart/scheduledEnd to the same POST /meetings the instant-meeting
 * flow uses (packages/validation's createMeetingSchema already supports this;
 * the dashboard just never exposed it in the UI before).
 *
 * Also doubles as the edit form for an existing scheduled meeting (pass
 * `editMeeting`) — there was previously no way to change a scheduled
 * meeting's topic/time/waiting-room/password at all once created, even
 * though PATCH /meetings/:id/settings (MeetingsService.updateSettings)
 * already accepted every one of those fields. Same shape of gap this
 * codebase has had before (H-11's password field, MeetingInvite): real,
 * working backend support with nothing in the UI ever reaching it. */
export function ScheduleMeetingModal({
  onClose,
  onScheduled,
  editMeeting,
}: {
  onClose: () => void;
  onScheduled: (meeting: Meeting) => void;
  editMeeting?: Meeting;
}) {
  const isEditing = Boolean(editMeeting);

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + 30, 0, 0);
  const defaultStart = now.toISOString().slice(0, 16);

  const initialDurationMinutes =
    editMeeting?.scheduledStart && editMeeting?.scheduledEnd
      ? Math.round(
          (new Date(editMeeting.scheduledEnd).getTime() - new Date(editMeeting.scheduledStart).getTime()) / 60_000,
        )
      : 30;
  // The actual current duration might not be one of the presets below (a
  // meeting edited some other way, or a non-round scheduledEnd) — add it as
  // its own option rather than silently snapping to 30 minutes the moment
  // someone opens Edit without touching Duration at all.
  const durationOptions = PRESET_DURATIONS.includes(initialDurationMinutes)
    ? PRESET_DURATIONS
    : [...PRESET_DURATIONS, initialDurationMinutes].sort((a, b) => a - b);

  const [title, setTitle] = useState(editMeeting?.title ?? "");
  const [start, setStart] = useState(
    editMeeting?.scheduledStart ? toDatetimeLocalValue(editMeeting.scheduledStart) : defaultStart,
  );
  const [duration, setDuration] = useState(initialDurationMinutes);
  // H-4: waitingRoomEnabled defaults to true server-side, but this modal
  // never surfaced that at all — a host scheduling a meeting had no way to
  // know or change it before sharing the invite, and attendees who arrived
  // on time were stuck waiting with no explanation. Defaults to true here
  // too (unchanged behavior for anyone who doesn't touch it), but now it's
  // an actual, visible choice instead of an invisible one.
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(editMeeting?.settings?.waitingRoomEnabled ?? true);
  // H-11: meeting passwords are fully built and enforced server-side
  // (createMeetingSchema already takes one, join-time verification already
  // works end to end) but no UI anywhere ever let a host actually set one —
  // confirmed by grepping every settings component in the app for
  // `password`. This is the fix, alongside the same field in Personal Room
  // Settings. In edit mode this is the same three-way MeetingPasswordField
  // that modal uses (leave as-is / set new / explicitly remove).
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const scheduledStart = new Date(start);
      const scheduledEnd = new Date(scheduledStart.getTime() + duration * 60_000);
      const meeting = isEditing
        ? await apiFetch<Meeting>(`/meetings/${editMeeting!.id}/settings`, {
            method: "PATCH",
            body: JSON.stringify({
              title: title || "Scheduled meeting",
              scheduledStart: scheduledStart.toISOString(),
              scheduledEnd: scheduledEnd.toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              password: removePassword ? null : password.trim() || undefined,
              settings: { waitingRoomEnabled },
            }),
          })
        : await apiFetch<Meeting>("/meetings", {
            method: "POST",
            body: JSON.stringify({
              title: title || "Scheduled meeting",
              type: "SCHEDULED",
              scheduledStart: scheduledStart.toISOString(),
              scheduledEnd: scheduledEnd.toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              password: password.trim() || undefined,
              settings: { waitingRoomEnabled },
            }),
          });
      onScheduled(meeting);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${isEditing ? "save" : "schedule"} meeting`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={isEditing ? "Edit meeting" : "Schedule a meeting"}>
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
            {durationOptions.map((mins) => (
              <option key={mins} value={mins}>
                {mins < 60 ? `${mins} minutes` : mins === 60 ? "1 hour" : `${mins / 60} hours`}
              </option>
            ))}
          </select>
        </Field>

        <Toggle
          label="Waiting room"
          description="Attendees wait for you to admit them before joining"
          checked={waitingRoomEnabled}
          onChange={setWaitingRoomEnabled}
        />

        {isEditing ? (
          <MeetingPasswordField
            requiresPassword={editMeeting!.requiresPassword ?? false}
            password={password}
            onPasswordChange={setPassword}
            removePassword={removePassword}
            onRemovePasswordChange={setRemovePassword}
          />
        ) : (
          <Field label="Password (optional)">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for no password"
              className="input"
              autoComplete="new-password"
            />
          </Field>
        )}

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
            {submitting ? (isEditing ? "Saving…" : "Scheduling…") : isEditing ? "Save changes" : "Schedule"}
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
