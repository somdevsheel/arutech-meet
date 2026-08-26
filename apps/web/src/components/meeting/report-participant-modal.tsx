"use client";

import { useState } from "react";
import type { ParticipantPresencePayload } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "@/components/dashboard/schedule-meeting-modal";

const REASONS: { value: string; label: string }[] = [
  { value: "HARASSMENT", label: "Harassment" },
  { value: "SPAM", label: "Spam" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "OTHER", label: "Other" },
];

/** Files a real report into the admin queue (`POST /meetings/:id/reports`,
 * reviewed at `/admin/reports`) — distinct from Block, which is immediate
 * and has no review step. Anyone who was actually in the meeting can report
 * anyone else in it, not just moderators — see docs/roadmap.md's Moderation
 * stage. */
export function ReportParticipantModal({
  meetingId,
  participant,
  onClose,
  onSubmitted,
}: {
  meetingId: string;
  participant: ParticipantPresencePayload;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState("HARASSMENT");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/meetings/${meetingId}/reports`, {
        method: "POST",
        body: JSON.stringify({
          ...(participant.userId ? { reportedUserId: participant.userId } : { reportedGuestName: participant.displayName }),
          reason,
          details: details.trim() || undefined,
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Report ${participant.displayName}`}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Details (optional)</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What happened?"
            className="input"
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-3 hover:bg-surface-field">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
