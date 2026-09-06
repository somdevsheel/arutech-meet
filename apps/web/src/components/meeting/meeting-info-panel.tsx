"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ShareLinkBox } from "./share-link-box";

interface PublicMeetingPreview {
  code: string;
  title: string;
  status: string;
  requiresPassword: boolean;
  waitingRoomEnabled: boolean;
}

interface Props {
  meetingCode: string;
  isRecording: boolean;
}

/** "Meeting info" — invite link, a security summary, and current
 * recording/AI-assistant status in one place, matching Zoom/Meet's own
 * "click the meeting name for details" pattern. Reuses the already-public
 * `GET /meetings/:code` preview endpoint for the security fields (it's the
 * same scrubbed shape a not-yet-joined guest sees — never the passwordHash
 * itself, only whether one is set) rather than adding a second endpoint. */
export function MeetingInfoPanel({ meetingCode, isRecording }: Props) {
  const [preview, setPreview] = useState<PublicMeetingPreview | null>(null);

  useEffect(() => {
    apiFetch<PublicMeetingPreview>(`/meetings/${meetingCode}`, { skipAuth: true })
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [meetingCode]);

  return (
    <div className="flex flex-col gap-5 p-3.5">
      <section>
        <ShareLinkBox code={meetingCode} title="Invite people" />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Security</h3>
        {!preview ? (
          <p className="text-xs text-ink-muted">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
            <SecurityRow label="Password required" on={preview.requiresPassword} />
            <SecurityRow label="Waiting room" on={preview.waitingRoomEnabled} />
          </ul>
        )}
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-muted">
          Media is encrypted in transit (DTLS-SRTP) between you and the server, and the API/WebSocket
          connection is TLS-encrypted — but this is not end-to-end encryption: the server can access
          decrypted media, which is what makes recording and the AI meeting assistant possible. See{" "}
          <span className="text-ink-muted2">docs/webrtc.md</span> for the full picture.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">In this meeting</h3>
        <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
          <li className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isRecording ? "bg-danger" : "bg-surface-border2"}`} />
            {isRecording ? "Recording is in progress" : "Not recording"}
          </li>
          <li className="text-[11px] text-ink-muted">
            The AI meeting assistant (transcript + summary) generates from a recording after it finishes —
            start one from the Record tab to use it.
          </li>
        </ul>
      </section>
    </div>
  );
}

function SecurityRow({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span className={on ? "text-success" : "text-ink-muted2"}>{on ? "On" : "Off"}</span>
    </li>
  );
}
