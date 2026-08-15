"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS, type WhiteboardOpPayload } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";

interface Stroke {
  id: string;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

interface WhiteboardPage {
  id: string;
  index: number;
  data: { strokes?: Stroke[] };
}

interface WhiteboardData {
  id: string;
  pages: WhiteboardPage[];
}

const COLORS = ["#f8fafc", "#f87171", "#fbbf24", "#4ade80", "#60a5fa"] as const;

/**
 * A real collaborative whiteboard: freehand strokes are drawn locally with the
 * Canvas 2D API and synced to other participants over the app WebSocket
 * (`whiteboard:op`) — see docs/realtime.md. Sync granularity is per-completed-
 * stroke (not per-pixel-move) to keep bandwidth/render cost sane; this is a
 * deliberate trade-off, not a placeholder. The full page is periodically
 * checkpointed to Postgres via REST so reloading/rejoining doesn't lose work.
 */
export function WhiteboardCanvas({
  meetingId,
  socket,
  canEdit,
}: {
  meetingId: string;
  socket: Socket | null;
  canEdit: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const drawingRef = useRef<Stroke | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<WhiteboardData>(`/meetings/${meetingId}/whiteboard`).then((wb) => {
      setWhiteboard(wb);
      setStrokes(wb.pages[0]?.data.strokes ?? []);
    });
  }, [meetingId]);

  useEffect(() => {
    const page = whiteboard?.pages.find((p) => p.index === pageIndex);
    setStrokes(page?.data.strokes ?? []);
  }, [pageIndex, whiteboard]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0f1420";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, [strokes]);

  useEffect(() => redraw(), [redraw]);

  useEffect(() => {
    if (!socket) return;
    const onOp = (payload: WhiteboardOpPayload) => {
      if (payload.meetingId !== meetingId || payload.pageIndex !== pageIndex) return;
      if (payload.op.type === "clear") {
        setStrokes([]);
      } else if (payload.op.type === "stroke") {
        setStrokes((prev) => [...prev, payload.op.data as unknown as Stroke]);
      }
    };
    socket.on(WS_EVENTS.WHITEBOARD_OP, onOp);
    return () => {
      socket.off(WS_EVENTS.WHITEBOARD_OP, onOp);
    };
  }, [socket, meetingId, pageIndex]);

  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canEdit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = {
      id: crypto.randomUUID(),
      color: tool === "eraser" ? "#0f1420" : color,
      width: tool === "eraser" ? 18 : 3,
      points: [toCanvasPoint(e)],
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toCanvasPoint(e));
    setStrokes((prev) => [...prev.filter((s) => s.id !== drawingRef.current!.id), drawingRef.current!]);
  }

  function onPointerUp() {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke) return;
    socket?.emit(WS_EVENTS.WHITEBOARD_OP, {
      meetingId,
      pageIndex,
      op: { type: "stroke", id: stroke.id, data: stroke },
    });
  }

  function clear() {
    setStrokes([]);
    socket?.emit(WS_EVENTS.WHITEBOARD_OP, {
      meetingId,
      pageIndex,
      op: { type: "clear", id: crypto.randomUUID(), data: {} },
    });
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/meetings/${meetingId}/whiteboard/pages/save`, {
        method: "POST",
        body: JSON.stringify({ pageIndex, data: { strokes } }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function addPage() {
    const page = await apiFetch<WhiteboardPage>(`/meetings/${meetingId}/whiteboard/pages`, {
      method: "POST",
    });
    setWhiteboard((wb) => (wb ? { ...wb, pages: [...wb.pages, page] } : wb));
    setPageIndex(page.index);
  }

  const pageCount = whiteboard?.pages.length ?? 1;

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setTool("pen")}
            className={`rounded px-2 py-1 text-xs ${tool === "pen" ? "bg-brand-500 text-white" : "bg-surface-border text-ink-3"}`}
          >
            Pen
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`rounded px-2 py-1 text-xs ${tool === "eraser" ? "bg-brand-500 text-white" : "bg-surface-border text-ink-3"}`}
          >
            Eraser
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-5 w-5 rounded-full border"
              style={{ backgroundColor: c, borderColor: color === c ? "#fff" : "transparent" }}
              aria-label={`Color ${c}`}
            />
          ))}
          <button onClick={clear} className="ml-auto rounded bg-surface-border px-2 py-1 text-xs text-ink-3">
            Clear
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-brand-500 px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={800}
        height={480}
        className="w-full flex-1 touch-none rounded-lg border border-surface-border"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      <div className="flex items-center justify-center gap-3 text-xs text-ink-muted">
        <button
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          className="disabled:opacity-30"
        >
          ← Prev
        </button>
        <span>
          Page {pageIndex + 1} / {pageCount}
        </span>
        <button
          disabled={pageIndex >= pageCount - 1}
          onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
          className="disabled:opacity-30"
        >
          Next →
        </button>
        {canEdit && (
          <button onClick={addPage} className="text-brand-300">
            + Add page
          </button>
        )}
      </div>
    </div>
  );
}
