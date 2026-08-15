"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "./schedule-meeting-modal";

export function JoinMeetingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");

  function submit() {
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/meeting/${trimmed}`);
  }

  return (
    <ModalShell onClose={onClose} title="Join a meeting">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Meeting code
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. p73q-7bak-xwnz"
            className="input"
            autoFocus
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-surface-border/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Join
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
