"use client";

import { useEffect, useRef, useState } from "react";
import type { BackgroundMode } from "@/hooks/use-virtual-background";

/** A handful of generated gradient presets — deliberately abstract rather than
 * pretending to be stock office/nature photography this app doesn't actually
 * have licensed assets for. Rendered once to a canvas and cached as data
 * URIs; "Custom" (below) is how a user supplies a real photo. */
const PRESETS: { name: string; colors: [string, string] }[] = [
  { name: "Ocean", colors: ["#1e3a5f", "#3b6fe0"] },
  { name: "Sunset", colors: ["#b8481a", "#e0a13b"] },
  { name: "Forest", colors: ["#123524", "#2c7a4b"] },
  { name: "Slate", colors: ["#26262e", "#4a4a58"] },
];

function renderGradient(colors: [string, string]): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Purely presentational — `mode`/`imagePath`/etc. all come from the caller
 * (MeetingToolbar), which calls useVirtualBackground() itself and stays
 * mounted for the whole meeting. This component only exists in the DOM
 * while the popover is open, so it must never own that state directly —
 * see MeetingToolbar's own comment on why. */
export function VirtualBackgroundPanel({
  onClose,
  supported,
  mode,
  imagePath,
  busy,
  error,
  isCameraEnabled,
  applyNone,
  applyBlur,
  applyImage,
}: {
  onClose: () => void;
  supported: boolean;
  mode: BackgroundMode;
  imagePath: string | null;
  busy: boolean;
  error: string | null;
  isCameraEnabled: boolean;
  applyNone: () => void;
  applyBlur: (blurRadius?: number) => void;
  applyImage: (path: string) => void;
}) {
  const [presets, setPresets] = useState<{ name: string; url: string }[] | null>(null);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPresets(PRESETS.map((p) => ({ name: p.name, url: renderGradient(p.colors) })));
  }, []);

  function pickCustomFile() {
    fileInputRef.current?.click();
  }

  function onCustomFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setCustomUrl(url);
    applyImage(url);
  }

  if (!supported) {
    return (
      <div className="w-64 rounded-xl border border-surface-border bg-surface-raised p-3 text-xs text-ink-muted">
        Virtual backgrounds aren&apos;t supported in this browser (needs WebGL + Insertable Streams
        support — try a recent Chrome or Edge).
      </div>
    );
  }

  return (
    <div className="w-72 rounded-xl border border-surface-border bg-surface-raised p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-2">Background</span>
        <button onClick={onClose} className="text-ink-muted2 hover:text-white">
          ✕
        </button>
      </div>

      {!isCameraEnabled && (
        <p className="mb-2 rounded-md bg-warn-bg px-2 py-1.5 text-[11px] text-warn">
          Turn on your camera to preview and apply a background.
        </p>
      )}
      {error && <p className="mb-2 text-[11px] text-danger">{error}</p>}

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={applyNone}
          disabled={busy || !isCameraEnabled}
          className={`col-span-3 rounded-lg border px-2 py-2 text-[11px] font-medium transition disabled:opacity-40 ${
            mode === "none"
              ? "border-brand-500 bg-brand-500/20 text-brand-300"
              : "border-surface-border2 text-ink-2 hover:bg-surface-field"
          }`}
        >
          None
        </button>
        <button
          onClick={() => applyBlur(15)}
          disabled={busy || !isCameraEnabled}
          className={`col-span-3 rounded-lg border px-2 py-2 text-[11px] font-medium transition disabled:opacity-40 ${
            mode === "blur"
              ? "border-brand-500 bg-brand-500/20 text-brand-300"
              : "border-surface-border2 text-ink-2 hover:bg-surface-field"
          }`}
        >
          Blur
        </button>

        {presets?.map(({ name, url }) => (
          <button
            key={name}
            onClick={() => applyImage(url)}
            disabled={busy || !isCameraEnabled}
            title={name}
            className={`relative h-14 overflow-hidden rounded-lg border-2 bg-cover bg-center transition disabled:opacity-40 ${
              mode === "image" && imagePath === url
                ? "border-brand-500"
                : "border-transparent hover:border-surface-border2"
            }`}
            style={{ backgroundImage: `url(${url})` }}
          />
        ))}

        <button
          onClick={pickCustomFile}
          disabled={busy || !isCameraEnabled}
          title="Upload your own image"
          className={`grid h-14 place-items-center rounded-lg border-2 border-dashed transition disabled:opacity-40 ${
            mode === "image" && imagePath === customUrl && customUrl
              ? "border-brand-500 bg-brand-500/10"
              : "border-surface-border2 text-ink-muted2 hover:bg-surface-field"
          }`}
        >
          {customUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob: object URL, not an optimizable remote asset
            <img
              src={customUrl}
              alt="Custom background"
              className="h-full w-full rounded-md object-cover"
            />
          ) : (
            <span className="text-lg">+</span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onCustomFileSelected}
        />
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-ink-muted2">
        Runs entirely on your device — the background image never leaves your browser, and a custom
        upload isn&apos;t saved anywhere (pick it again next time).
      </p>
    </div>
  );
}
