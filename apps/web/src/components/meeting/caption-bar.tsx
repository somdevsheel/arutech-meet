"use client";

import { useMemo } from "react";
import { useTranscriptions, useParticipants } from "@livekit/components-react";

/**
 * Live caption strip — reads LiveKit's own native room transcription
 * directly (useTranscriptions()), not a custom WebSocket event. The text
 * itself is published by the captions agent worker (services/transcription)
 * attributed to each real speaker's own LiveKit identity via
 * LocalParticipant.publishTranscription — this component never talks to our
 * own realtime gateway at all, only to whatever LiveKit itself already
 * delivered into this room's client SDK state. See CaptionsService/
 * docs/roadmap.md for the agent side.
 */
export function CaptionBar({ onHide }: { onHide: () => void }) {
  const transcriptions = useTranscriptions();
  const participants = useParticipants();

  const nameByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) map.set(p.identity, p.name || p.identity);
    return map;
  }, [participants]);

  // One line per speaker: the most recent segment we've heard from them,
  // newest speaker last so the strip reads top-to-bottom in speaking order.
  const latestBySpeaker = useMemo(() => {
    const byIdentity = new Map<string, (typeof transcriptions)[number]>();
    for (const t of transcriptions) {
      const identity = t.participantInfo.identity;
      const existing = byIdentity.get(identity);
      if (!existing || t.streamInfo.timestamp >= existing.streamInfo.timestamp) {
        byIdentity.set(identity, t);
      }
    }
    return [...byIdentity.values()]
      .sort((a, b) => a.streamInfo.timestamp - b.streamInfo.timestamp)
      .slice(-2);
  }, [transcriptions]);

  if (latestBySpeaker.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-1 px-3">
      <div className="rounded-lg bg-black/75 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-sm">
        {latestBySpeaker.map((t) => (
          <p key={t.streamInfo.id} className="leading-snug">
            <span className="font-semibold text-brand-300">{nameByIdentity.get(t.participantInfo.identity) ?? "Someone"}: </span>
            {t.text}
          </p>
        ))}
      </div>
      <button
        onClick={onHide}
        className="self-center rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-medium text-white/70 hover:text-white"
      >
        Hide captions
      </button>
    </div>
  );
}
