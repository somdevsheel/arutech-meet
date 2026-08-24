"use client";

import { useCallback, useRef, useState } from "react";

/** Records a real voice message via `getUserMedia` + `MediaRecorder` — a
 * genuinely separate, much simpler recording than Stage 18's local meeting
 * recording (a single mic track, no canvas compositing, no video at all).
 * Shared by meeting chat and Team Chat, both of which upload the result
 * through their own existing presigned-upload pattern (see chat-panel.tsx /
 * the Team Chat page) exactly like any other file attachment — this hook
 * only owns the capture, not the upload. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((file: File | null) => void) | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType ?? "audio/webm" });
        const ext = (mimeType ?? "audio/webm").includes("mp4") ? "m4a" : "webm";
        const file = blob.size > 0 ? new File([blob], `voice-message.${ext}`, { type: blob.type }) : null;
        resolveRef.current?.(file);
        resolveRef.current = null;
      };
      recorder.start(500);
      recorderRef.current = recorder;
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Couldn't access your microphone");
    }
  }, []);

  /** Resolves with the recorded File, or null if canceled/nothing captured. */
  const stop = useCallback((): Promise<File | null> => {
    return new Promise((resolve) => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setRecording(false);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        resolveRef.current = resolve;
        recorderRef.current.stop();
      } else {
        resolve(null);
      }
      recorderRef.current = null;
    });
  }, []);

  const cancel = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setRecording(false);
    resolveRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }, []);

  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  return { recording, elapsed, error, supported, start, stop, cancel };
}
