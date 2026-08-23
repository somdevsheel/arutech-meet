"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track } from "livekit-client";

type State = "idle" | "recording" | "unsupported";

/** A genuinely separate code path from the server-side LiveKit Egress
 * recording above — this runs entirely in the browser and never touches the
 * API. It captures exactly what this participant currently sees: every
 * `<video>` element inside the meeting's video grid, redrawn onto a canvas
 * every frame (`data-video-grid-root` in `meeting-room.tsx`), mixed with
 * every remote participant's audio (LiveKit's `RoomAudioRenderer` renders
 * those as hidden `<audio>` elements in the same subtree) plus this
 * participant's own microphone — reusing the already-published local mic
 * track's `MediaStreamTrack` rather than opening the device a second time.
 * The result downloads directly as a `.webm` file the moment recording
 * stops; nothing is ever uploaded anywhere. Useful as a fallback when
 * server-side recording isn't desired or available (no host/Egress
 * dependency — any participant can use it), at the cost of only capturing
 * this one participant's local view/mix rather than a clean per-participant
 * composite. */
export function LocalRecordingControl() {
  const { localParticipant } = useLocalParticipant();
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wrappedAudioEls = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());
  // Periodically re-scans for newly-joined participants' `<audio>` elements
  // (a fresh join mid-recording wouldn't otherwise get mixed in) — separate
  // from the elapsed-time ticker below so stopping either doesn't touch the
  // other's interval by mistake.
  const audioRescanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === "undefined") {
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

    const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (micTrack) {
      const micStream = new MediaStream([micTrack]);
      // Own mic connects only to `dest` (the recording), never to
      // `ctx.destination` — playing your own mic back to your own speakers
      // would be a live echo.
      audioCtx.createMediaStreamSource(micStream).connect(dest);
    }

    drawFrame();
    const canvasStream = canvas.captureStream(30);
    const mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
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
  }

  function stop() {
    stopInternal();
    setState("idle");
  }

  const timeLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (state === "unsupported") {
    return (
      <p className="text-[11px] text-ink-muted">
        Local recording isn&apos;t supported in this browser (needs Canvas.captureStream and MediaRecorder).
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
      <p className="mb-2 text-[11px] text-ink-muted">
        Records this device&apos;s own view (everyone visible + all audio) straight to a file on your computer.
        Nothing is uploaded — no host needed.
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
