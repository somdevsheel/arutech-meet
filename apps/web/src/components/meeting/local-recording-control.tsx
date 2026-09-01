"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";

type State = "idle" | "recording" | "unsupported";

interface LocalRecordingValue {
  state: State;
  elapsed: number;
  start: () => void;
  stop: () => void;
}

const LocalRecordingContext = createContext<LocalRecordingValue | null>(null);

/** Owns the actual `MediaRecorder`/`AudioContext`/capture-loop lifecycle for
 * local (device-only) recording — see the longer explanation on
 * `LocalRecordingControl` below for what this captures and why. Mounted once
 * directly in `meeting-room.tsx`, *outside* `<LiveKitRoom>` itself (not just
 * outside the panel-switch conditional inside it) — see the mic-capture
 * comment in `start()` below for why that placement specifically matters:
 * `<LiveKitRoom key={conn.label ?? "main"}>` deliberately force-remounts
 * whenever a participant joins or leaves a breakout room (see that key's own
 * comment in meeting-room.tsx), which used to take this provider down with
 * it — a recording in progress would silently stop and force-download a
 * partial file the instant someone joined a breakout room, with no warning
 * and no way to opt out. Being outside that remount boundary entirely means
 * neither that nor any other panel-switch inside the room can touch it;
 * only an explicit "Stop" click or leaving the meeting does. */
export function LocalRecordingProvider({
  children,
  meetingId,
  socket,
}: {
  children: ReactNode;
  /** Broadcasts LOCAL_RECORDING_STARTED/STOPPED so everyone else in the
   * meeting actually gets told this is happening (see H-1 in the QA sweep —
   * previously nobody else had any signal at all). Optional purely so this
   * component doesn't hard-crash if ever mounted without a live socket
   * (e.g. a future standalone usage) — meeting-room.tsx always provides both. */
  meetingId?: string;
  socket?: Socket | null;
}) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const wrappedAudioEls = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());
  // Periodically re-scans for newly-joined participants' `<audio>` elements
  // (a fresh join mid-recording wouldn't otherwise get mixed in) — separate
  // from the elapsed-time ticker below so stopping either doesn't touch the
  // other's interval by mistake.
  const audioRescanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (
      typeof HTMLCanvasElement === "undefined" ||
      !HTMLCanvasElement.prototype.captureStream ||
      typeof MediaRecorder === "undefined"
    ) {
      setState("unsupported");
    }
    return () => {
      stopInternal();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, []);

  function drawFrame() {
    const canvas = canvasRef.current;
    const root = document.querySelector("[data-video-grid-root]");
    if (!canvas || !root) {
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const videos = Array.from(root.querySelectorAll("video")).filter(
      (v) => v.videoWidth > 0 && v.videoHeight > 0,
    );

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (videos.length > 0) {
      const cols = Math.ceil(Math.sqrt(videos.length));
      const rows = Math.ceil(videos.length / cols);
      const cellW = canvas.width / cols;
      const cellH = canvas.height / rows;
      videos.forEach((v, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Letterbox each tile into its cell rather than stretching, matching
        // how the on-screen grid itself preserves aspect ratio per tile.
        const scale = Math.min(cellW / v.videoWidth, cellH / v.videoHeight);
        const w = v.videoWidth * scale;
        const h = v.videoHeight * scale;
        const x = col * cellW + (cellW - w) / 2;
        const y = row * cellH + (cellH - h) / 2;
        ctx.drawImage(v, x, y, w, h);
      });
    }

    rafRef.current = requestAnimationFrame(drawFrame);
  }

  /** Connects every `<audio>` element currently under the video-grid root
   * into the mix — called once at start and again on a short interval while
   * recording, since a participant joining mid-recording adds a new
   * `<audio>` element that didn't exist yet at start time. Each element is
   * only ever wrapped once (`createMediaElementSource` throws on a second
   * call for the same element) and is re-connected to the audio context's
   * own destination too, so wrapping it for recording never silences it for
   * this participant. */
  function connectAudioElements(ctx: AudioContext, dest: MediaStreamAudioDestinationNode) {
    const root = document.querySelector("[data-video-grid-root]");
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll("audio"))) {
      if (wrappedAudioEls.current.has(el)) continue;
      wrappedAudioEls.current.add(el);
      try {
        const source = ctx.createMediaElementSource(el);
        source.connect(dest);
        source.connect(ctx.destination);
      } catch {
        // Already wrapped by something else, or not a capturable element — skip it.
      }
    }
  }

  async function start() {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();

    connectAudioElements(audioCtx, dest);
    // Recording sessions can run for a while and participants come and go —
    // catch newly-joined participants' audio without requiring a restart.
    audioRescanTimerRef.current = setInterval(() => connectAudioElements(audioCtx, dest), 3000);

    // A deliberately independent getUserMedia call, not a reuse of LiveKit's
    // own published mic track (which is how this used to work, and is one
    // reason opening the device a second time was worth avoiding — see git
    // history). LiveKit's track lives and dies with whichever Room is
    // currently connected, which is exactly what this provider now has to
    // survive (breakout-room joins force a full disconnect/reconnect). This
    // stream is entirely ours: same physical microphone, but its lifecycle
    // is independent, so a room switch underneath it has nothing to disrupt.
    // Browsers handle multiple simultaneous consumers of the same input
    // device fine, and since the browser already granted mic access for the
    // meeting itself, this second request resolves without another prompt.
    // Trade-off: this uses the OS/browser default input rather than
    // whatever specific device the user picked in LiveKit's own device
    // picker — acceptable for most single-mic setups, not perfect for
    // someone actively using a non-default mic.
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      // Own mic connects only to `dest` (the recording), never to
      // `ctx.destination` — playing your own mic back to your own speakers
      // would be a live echo.
      audioCtx.createMediaStreamSource(micStream).connect(dest);
    } catch {
      // Mic capture failed/denied — still record video-only rather than not
      // starting at all.
    }

    drawFrame();
    const canvasStream = canvas.captureStream(30);
    const mixedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(mixedStream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType ?? "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `local-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    recorder.start(1000);
    recorderRef.current = recorder;

    setElapsed(0);
    elapsedTickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    setState("recording");
    if (socket && meetingId) socket.emit(WS_EVENTS.LOCAL_RECORDING_STARTED, { meetingId });
  }

  function stopInternal() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioRescanTimerRef.current) clearInterval(audioRescanTimerRef.current);
    audioRescanTimerRef.current = null;
    if (elapsedTickRef.current) clearInterval(elapsedTickRef.current);
    elapsedTickRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    canvasRef.current = null;
    // Unlike the old borrowed-from-LiveKit track (which LiveKit itself owned
    // and stopped), this stream is ours alone now — leaving it open after
    // stopping would leak an active microphone handle (and the browser's
    // "mic in use" indicator) for the rest of the meeting.
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }

  function stop() {
    const wasRecording = state === "recording";
    stopInternal();
    setState("idle");
    // Only for an explicit Stop click, not the unmount cleanup path (which
    // calls stopInternal() directly) — nobody needs a "stopped" notice for
    // a socket that's also in the middle of tearing down.
    if (wasRecording && socket && meetingId) socket.emit(WS_EVENTS.LOCAL_RECORDING_STOPPED, { meetingId });
  }

  return (
    <LocalRecordingContext.Provider value={{ state, elapsed, start, stop }}>
      {children}
    </LocalRecordingContext.Provider>
  );
}

/** A genuinely separate code path from the server-side LiveKit Egress
 * recording above — this runs entirely in the browser and never touches the
 * API. It captures exactly what this participant currently sees: every
 * `<video>` element inside the meeting's video grid, redrawn onto a canvas
 * every frame (`data-video-grid-root` in `meeting-room.tsx`), mixed with
 * every remote participant's audio (LiveKit's `RoomAudioRenderer` renders
 * those as hidden `<audio>` elements in the same subtree) plus this
 * participant's own microphone, captured via its own independent
 * `getUserMedia` call — see `start()`'s own comment for why that's
 * deliberate. The result downloads directly as a `.webm` file the moment recording
 * stops; nothing is ever uploaded anywhere. Useful as a fallback when
 * server-side recording isn't desired or available (no host/Egress
 * dependency — any participant can use it), at the cost of only capturing
 * this one participant's local view/mix rather than a clean per-participant
 * composite.
 *
 * Purely presentational — the actual recorder lives in `LocalRecordingProvider`
 * above, which stays mounted for the whole meeting regardless of which panel
 * tab is open. This component only renders while the Record tab itself is
 * open, so it must never own any recording state directly. */
export function LocalRecordingControl() {
  const ctx = useContext(LocalRecordingContext);
  if (!ctx) {
    throw new Error("LocalRecordingControl must be rendered inside a LocalRecordingProvider");
  }
  const { state, elapsed, start, stop } = ctx;

  const timeLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (state === "unsupported") {
    return (
      <p className="text-[11px] text-ink-muted">
        Local recording isn&apos;t supported in this browser (needs Canvas.captureStream and
        MediaRecorder).
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
      <p className="mb-2 text-[11px] text-ink-muted">
        Records this device&apos;s own view (everyone visible + all audio) straight to a file on
        your computer. Nothing is uploaded — no host needed.
      </p>
      {state === "recording" ? (
        <button
          onClick={stop}
          className="flex w-full items-center justify-center gap-2 rounded bg-danger-strong py-2 text-xs font-medium text-white"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
          Stop &amp; save local recording · {timeLabel}
        </button>
      ) : (
        <button
          onClick={start}
          className="w-full rounded border border-surface-border2 bg-surface-field py-2 text-xs font-medium text-ink-2 hover:brightness-110"
        >
          Start local recording
        </button>
      )}
    </div>
  );
}
