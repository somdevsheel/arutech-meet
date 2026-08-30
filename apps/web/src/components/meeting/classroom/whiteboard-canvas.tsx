"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS, type WhiteboardOpPayload } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";

type Tool = "select" | "pen" | "eraser" | "rectangle" | "ellipse" | "line" | "text";

interface BaseItem {
  id: string;
  color: string;
  width: number;
}
interface StrokeItem extends BaseItem {
  kind: "stroke";
  points: { x: number; y: number }[];
}
interface ShapeItem extends BaseItem {
  kind: "rectangle" | "ellipse" | "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface TextItem extends BaseItem {
  kind: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
}
type Item = StrokeItem | ShapeItem | TextItem;

/** Undo/redo is deliberately local-only, not a synced global timeline — same
 * choice most collaborative canvases make (Excalidraw, Miro): undo reverses
 * *your own* last local action, never someone else's. A globally-ordered undo
 * across concurrent editors needs real conflict resolution (CRDT/OT); this
 * app's whiteboard sync is a much simpler last-write-wins-by-id broadcast
 * (see the `onOp` handler below), which a global undo would silently corrupt
 * the moment two people are drawing at once. */
type Action =
  | { type: "add"; item: Item }
  | { type: "delete"; item: Item }
  | { type: "update"; before: Item; after: Item }
  | { type: "clear"; items: Item[] };

interface WhiteboardPage {
  id: string;
  index: number;
  data: { items?: Item[]; strokes?: (BaseItem & { points: { x: number; y: number }[] })[] };
}

interface WhiteboardData {
  id: string;
  pages: WhiteboardPage[];
}

const COLORS = ["#f8fafc", "#f87171", "#fbbf24", "#4ade80", "#60a5fa"] as const;
const BG = "#0f1420";
const CANVAS_W = 800;
const CANVAS_H = 480;

function itemsFromPageData(data: WhiteboardPage["data"]): Item[] {
  if (data.items) return data.items;
  // Legacy pages saved before shapes/text existed only ever had `strokes` —
  // treat each as a stroke-kind item so old whiteboards still load correctly.
  return (data.strokes ?? []).map((s) => ({ ...s, kind: "stroke" as const }));
}

function opTypeFor(item: Item): "stroke" | "shape" | "text" {
  if (item.kind === "stroke") return "stroke";
  if (item.kind === "text") return "text";
  return "shape";
}

function boundingBox(item: Item): { x: number; y: number; w: number; h: number } {
  if (item.kind === "stroke") {
    const xs = item.points.map((p) => p.x);
    const ys = item.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (item.kind === "text") {
    return {
      x: item.x,
      y: item.y - item.fontSize,
      w: item.fontSize * item.text.length * 0.6,
      h: item.fontSize * 1.3,
    };
  }
  const x = Math.min(item.x1, item.x2);
  const y = Math.min(item.y1, item.y2);
  return { x, y, w: Math.abs(item.x2 - item.x1), h: Math.abs(item.y2 - item.y1) };
}

function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function hitTest(item: Item, p: { x: number; y: number }): boolean {
  const pad = 6;
  if (item.kind === "stroke") {
    const threshold = item.width / 2 + pad;
    for (let i = 1; i < item.points.length; i++) {
      if (distToSegment(p, item.points[i - 1]!, item.points[i]!) <= threshold) return true;
    }
    return false;
  }
  if (item.kind === "line") {
    return (
      distToSegment(p, { x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }) <=
      item.width / 2 + pad
    );
  }
  const box = boundingBox(item);
  return (
    p.x >= box.x - pad &&
    p.x <= box.x + box.w + pad &&
    p.y >= box.y - pad &&
    p.y <= box.y + box.h + pad
  );
}

function translateItem(item: Item, dx: number, dy: number): Item {
  if (item.kind === "stroke") {
    return { ...item, points: item.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
  }
  if (item.kind === "text") {
    return { ...item, x: item.x + dx, y: item.y + dy };
  }
  return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
}

interface WhiteboardContextValue {
  whiteboard: WhiteboardData | null;
  pageIndex: number;
  setPageIndex: (i: number | ((cur: number) => number)) => void;
  items: Item[];
  setItems: React.Dispatch<React.SetStateAction<Item[]>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  emitItem: (item: Item) => void;
  emitErase: (id: string) => void;
  pushAction: (action: Action) => void;
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
  clear: () => void;
  save: () => Promise<void>;
  addPage: () => Promise<void>;
}

const WhiteboardContext = createContext<WhiteboardContextValue | null>(null);

/** Owns the whiteboard's actual data — page/item state, the WS sync
 * listener, undo/redo, and REST fetch/save — independently of whether the
 * Whiteboard tab is currently visible. Mounted once directly in
 * meeting-room.tsx, outside the `{panel === "..." && ...}` conditional that
 * used to own this state directly inside `WhiteboardCanvas` — the same
 * pattern (and the same underlying bug) `LocalRecordingProvider` was
 * already split out for. Before this, switching to any other Tools sub-tab
 * (or closing the panel) unmounted the whiteboard entirely: local edits
 * since the last explicit Save vanished from view (remote edits kept
 * arriving via the socket but were dropped on the floor with nowhere to go
 * — the listener didn't exist while unmounted), and worse, clicking Save
 * after coming back with even one new local item would overwrite the real
 * page for everyone with just that one item. `WhiteboardCanvas` below is
 * now purely presentational: the toolbar + `<canvas>` + pointer-drawing
 * interactions, which only make sense while actually visible anyway. */
export function WhiteboardProvider({
  meetingId,
  socket,
  children,
}: {
  meetingId: string;
  socket: Socket | null;
  children: ReactNode;
}) {
  const [whiteboard, setWhiteboard] = useState<WhiteboardData | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const undoStack = useRef<Action[]>([]);
  const redoStack = useRef<Action[]>([]);
  // Mutating a ref doesn't trigger a re-render on its own, and some history
  // mutations below have no other setState call to piggyback on — this
  // exists purely to force one so canUndo/canRedo reflect the stacks'
  // current length immediately.
  const [, bumpHistory] = useState(0);

  useEffect(() => {
    apiFetch<WhiteboardData>(`/meetings/${meetingId}/whiteboard`).then((wb) => {
      setWhiteboard(wb);
      setItems(itemsFromPageData(wb.pages[0]?.data ?? {}));
    });
  }, [meetingId]);

  useEffect(() => {
    const page = whiteboard?.pages.find((p) => p.index === pageIndex);
    setItems(itemsFromPageData(page?.data ?? {}));
    setSelectedId(null);
    undoStack.current = [];
    redoStack.current = [];
  }, [pageIndex, whiteboard]);

  // Upserts by id so this handles both a brand-new item AND a remote move of
  // an existing one identically — the sender only ever emits the item's full,
  // current state, never a delta. Now lives at the provider level so remote
  // edits are never silently dropped just because the Whiteboard tab isn't
  // the one currently open.
  useEffect(() => {
    if (!socket) return;
    const onOp = (payload: WhiteboardOpPayload) => {
      if (payload.meetingId !== meetingId || payload.pageIndex !== pageIndex) return;
      if (payload.op.type === "clear") {
        setItems([]);
        setSelectedId(null);
      } else if (payload.op.type === "erase") {
        const id = (payload.op.data as { id: string }).id;
        setItems((prev) => prev.filter((i) => i.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
      } else {
        const item = payload.op.data as unknown as Item;
        setItems((prev) => [...prev.filter((i) => i.id !== item.id), item]);
      }
    };
    socket.on(WS_EVENTS.WHITEBOARD_OP, onOp);
    return () => {
      socket.off(WS_EVENTS.WHITEBOARD_OP, onOp);
    };
  }, [socket, meetingId, pageIndex]);

  function emitItem(item: Item) {
    socket?.emit(WS_EVENTS.WHITEBOARD_OP, {
      meetingId,
      pageIndex,
      op: { type: opTypeFor(item), id: item.id, data: item as unknown as Record<string, unknown> },
    });
  }

  function emitErase(id: string) {
    socket?.emit(WS_EVENTS.WHITEBOARD_OP, {
      meetingId,
      pageIndex,
      op: { type: "erase", id, data: { id } },
    });
  }

  function emitClearOnly() {
    socket?.emit(WS_EVENTS.WHITEBOARD_OP, {
      meetingId,
      pageIndex,
      op: { type: "clear", id: crypto.randomUUID(), data: {} },
    });
  }

  function pushAction(action: Action) {
    undoStack.current.push(action);
    redoStack.current = [];
    bumpHistory((t) => t + 1);
  }

  function undo() {
    const action = undoStack.current.pop();
    if (!action) return;
    if (action.type === "add") {
      setItems((prev) => prev.filter((i) => i.id !== action.item.id));
      emitErase(action.item.id);
    } else if (action.type === "delete") {
      setItems((prev) => [...prev, action.item]);
      emitItem(action.item);
    } else if (action.type === "update") {
      setItems((prev) => prev.map((i) => (i.id === action.before.id ? action.before : i)));
      emitItem(action.before);
    } else if (action.type === "clear") {
      setItems(action.items);
      for (const item of action.items) emitItem(item);
    }
    redoStack.current.push(action);
    setSelectedId(null);
    bumpHistory((t) => t + 1);
  }

  function redo() {
    const action = redoStack.current.pop();
    if (!action) return;
    if (action.type === "add") {
      setItems((prev) => [...prev, action.item]);
      emitItem(action.item);
    } else if (action.type === "delete") {
      setItems((prev) => prev.filter((i) => i.id !== action.item.id));
      emitErase(action.item.id);
    } else if (action.type === "update") {
      setItems((prev) => prev.map((i) => (i.id === action.after.id ? action.after : i)));
      emitItem(action.after);
    } else if (action.type === "clear") {
      setItems([]);
      emitClearOnly();
    }
    undoStack.current.push(action);
    setSelectedId(null);
    bumpHistory((t) => t + 1);
  }

  function deleteSelected() {
    setSelectedId((currentId) => {
      if (!currentId) return currentId;
      setItems((prev) => {
        const item = prev.find((i) => i.id === currentId);
        if (!item) return prev;
        pushAction({ type: "delete", item });
        emitErase(currentId);
        return prev.filter((i) => i.id !== currentId);
      });
      return null;
    });
  }

  function clear() {
    setItems((prev) => {
      if (prev.length > 0) pushAction({ type: "clear", items: prev });
      return [];
    });
    setSelectedId(null);
    emitClearOnly();
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/meetings/${meetingId}/whiteboard/pages/save`, {
        method: "POST",
        body: JSON.stringify({ pageIndex, data: { items } }),
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

  const value: WhiteboardContextValue = {
    whiteboard,
    pageIndex,
    setPageIndex,
    items,
    setItems,
    selectedId,
    setSelectedId,
    saving,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    emitItem,
    emitErase,
    pushAction,
    undo,
    redo,
    deleteSelected,
    clear,
    save,
    addPage,
  };

  return <WhiteboardContext.Provider value={value}>{children}</WhiteboardContext.Provider>;
}

function useWhiteboard(): WhiteboardContextValue {
  const ctx = useContext(WhiteboardContext);
  if (!ctx) {
    throw new Error("WhiteboardCanvas must be rendered inside a WhiteboardProvider");
  }
  return ctx;
}

/**
 * Purely presentational: the toolbar, the `<canvas>` element, and the
 * pointer-driven drawing/select/move interactions — all of which only make
 * sense while this is actually visible, so they stay local here rather
 * than living in the always-mounted provider above. The item data itself,
 * undo/redo, and the WS sync are all read from context instead of owned
 * here — see `WhiteboardProvider`'s doc comment for why.
 */
export function WhiteboardCanvas({ canEdit }: { canEdit: boolean }) {
  const {
    pageIndex,
    setPageIndex,
    items,
    setItems,
    selectedId,
    setSelectedId,
    saving,
    canUndo,
    canRedo,
    emitItem,
    pushAction,
    undo,
    redo,
    deleteSelected,
    clear,
    save,
    addPage,
    whiteboard,
  } = useWhiteboard();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [tool, setTool] = useState<Tool>("pen");
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const drawingRef = useRef<Item | null>(null);
  const dragRef = useRef<{ id: string; before: Item; lastPoint: { x: number; y: number } } | null>(
    null,
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const item of items) {
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = item.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (item.kind === "stroke") {
        if (item.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(item.points[0]!.x, item.points[0]!.y);
        for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
      } else if (item.kind === "rectangle") {
        const box = boundingBox(item);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      } else if (item.kind === "ellipse") {
        const box = boundingBox(item);
        ctx.beginPath();
        ctx.ellipse(
          box.x + box.w / 2,
          box.y + box.h / 2,
          Math.abs(box.w) / 2,
          Math.abs(box.h) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      } else if (item.kind === "line") {
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
      } else if (item.kind === "text") {
        ctx.font = `${item.fontSize}px sans-serif`;
        ctx.fillText(item.text, item.x, item.y);
      }

      if (item.id === selectedId) {
        const box = boundingBox(item);
        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
        ctx.restore();
      }
    }
  }, [items, selectedId]);

  useEffect(() => redraw(), [redraw]);

  // Deliberately not React's `autoFocus` prop: that focuses synchronously
  // during the commit phase, which lands in the same tick as the very click
  // that placed this input — the browser's own post-click focus handling can
  // then immediately blur it again before the user ever types a key, which
  // (since blur commits/discards) silently threw the text tool away on
  // every single use. Deferring to the next animation frame lets that click
  // fully settle first.
  useEffect(() => {
    if (!textInput) return;
    const id = requestAnimationFrame(() => textInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [textInput]);

  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canEdit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e);

    if (tool === "select") {
      const hit = [...items].reverse().find((i) => hitTest(i, p));
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = { id: hit.id, before: hit, lastPoint: p };
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "text") {
      setTextInput(p);
      return;
    }

    if (tool === "pen" || tool === "eraser") {
      drawingRef.current = {
        id: crypto.randomUUID(),
        kind: "stroke",
        color: tool === "eraser" ? BG : color,
        width: tool === "eraser" ? 18 : width,
        points: [p],
      };
      return;
    }

    // rectangle | ellipse | line — the only tools left after the branches above
    drawingRef.current = {
      id: crypto.randomUUID(),
      kind: tool as "rectangle" | "ellipse" | "line",
      color,
      width,
      x1: p.x,
      y1: p.y,
      x2: p.x,
      y2: p.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = toCanvasPoint(e);

    if (tool === "select" && dragRef.current) {
      const dx = p.x - dragRef.current.lastPoint.x;
      const dy = p.y - dragRef.current.lastPoint.y;
      dragRef.current.lastPoint = p;
      setItems((prev) =>
        prev.map((i) => (i.id === dragRef.current!.id ? translateItem(i, dx, dy) : i)),
      );
      return;
    }

    if (!drawingRef.current) return;
    const draft = drawingRef.current;
    if (draft.kind === "stroke") {
      draft.points.push(p);
    } else if (draft.kind === "rectangle" || draft.kind === "ellipse" || draft.kind === "line") {
      // Text never lands in drawingRef (it's placed via the textInput overlay
      // below, not dragged) — this branch is only ever the three shape kinds.
      draft.x2 = p.x;
      draft.y2 = p.y;
    }
    setItems((prev) => [...prev.filter((i) => i.id !== draft.id), draft]);
  }

  function onPointerUp() {
    if (tool === "select") {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const after = items.find((i) => i.id === drag.id);
      if (!after || after === drag.before) return;
      // No-op drag (a plain click that didn't move anything) shouldn't
      // clutter the undo stack or spam a sync event.
      const moved = JSON.stringify(after) !== JSON.stringify(drag.before);
      if (!moved) return;
      pushAction({ type: "update", before: drag.before, after });
      emitItem(after);
      return;
    }

    const draft = drawingRef.current;
    drawingRef.current = null;
    if (!draft) return;

    if (draft.kind !== "stroke") {
      const box = boundingBox(draft);
      if (box.w < 3 && box.h < 3) {
        // Accidental click-without-drag on a shape tool — discard rather
        // than leaving an invisible zero-size shape behind.
        setItems((prev) => prev.filter((i) => i.id !== draft.id));
        return;
      }
    } else if (draft.points.length < 2) {
      setItems((prev) => prev.filter((i) => i.id !== draft.id));
      return;
    }

    if (tool !== "eraser") pushAction({ type: "add", item: draft });
    emitItem(draft);
  }

  function commitText(text: string) {
    if (!textInput || !text.trim()) {
      setTextInput(null);
      return;
    }
    const item: TextItem = {
      id: crypto.randomUUID(),
      kind: "text",
      color,
      width,
      x: textInput.x,
      y: textInput.y,
      text: text.trim(),
      fontSize: 16,
    };
    setItems((prev) => [...prev, item]);
    pushAction({ type: "add", item });
    emitItem(item);
    setTextInput(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deleteSelected]);

  const pageCount = whiteboard?.pages.length ?? 1;

  const TOOLS: { key: Tool; label: string }[] = [
    { key: "select", label: "Select" },
    { key: "pen", label: "Pen" },
    { key: "rectangle", label: "Rect" },
    { key: "ellipse", label: "Ellipse" },
    { key: "line", label: "Line" },
    { key: "text", label: "Text" },
    { key: "eraser", label: "Eraser" },
  ];

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTool(t.key);
                setSelectedId(null);
              }}
              className={`rounded px-2 py-1 text-xs ${tool === t.key ? "bg-brand-500 text-white" : "bg-surface-border text-ink-3"}`}
            >
              {t.label}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-surface-border" />

          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-5 w-5 rounded-full border"
              style={{ backgroundColor: c, borderColor: color === c ? "#fff" : "transparent" }}
              aria-label={`Color ${c}`}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
            className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Custom color"
          />

          <label className="flex items-center gap-1 text-[11px] text-ink-muted">
            Width
            <input
              type="range"
              min={1}
              max={20}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-16 align-middle"
            />
          </label>

          <span className="mx-1 h-5 w-px bg-surface-border" />

          <button
            onClick={undo}
            disabled={!canUndo}
            className="rounded bg-surface-border px-2 py-1 text-xs text-ink-3 disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="rounded bg-surface-border px-2 py-1 text-xs text-ink-3 disabled:opacity-30"
          >
            Redo
          </button>
          {selectedId && (
            <button
              onClick={deleteSelected}
              className="rounded bg-danger-strong px-2 py-1 text-xs text-white"
            >
              Delete
            </button>
          )}

          <button
            onClick={clear}
            className="ml-auto rounded bg-surface-border px-2 py-1 text-xs text-ink-3"
          >
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

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="h-full w-full touch-none rounded-lg border border-surface-border"
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {textInput && (
          <input
            ref={textInputRef}
            data-testid="whiteboard-text-input"
            className="absolute z-10 rounded border border-brand-500 bg-surface-raised px-1 text-sm text-white outline-none"
            style={{
              left: `${(textInput.x / CANVAS_W) * 100}%`,
              top: `${(textInput.y / CANVAS_H) * 100 - 3}%`,
              color,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText(e.currentTarget.value);
              if (e.key === "Escape") setTextInput(null);
            }}
            onBlur={(e) => commitText(e.currentTarget.value)}
          />
        )}
      </div>

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
