"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "./schedule-meeting-modal";

interface PersonalRoomSettings {
  waitingRoomEnabled: boolean;
  allowChat: boolean;
  allowRecording: boolean;
}

/** Real settings, backed by the same PATCH /meetings/:id/settings every other
 * meeting uses (MeetingsService.updateSettings) — not personal-room-specific
 * plumbing, just a UI for a knob that already existed. */
export function PersonalRoomSettingsModal({
  meetingId,
  initial,
  onClose,
  onSaved,
}: {
  meetingId: string;
  initial: PersonalRoomSettings;
  onClose: () => void;
  onSaved: (settings: PersonalRoomSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/meetings/${meetingId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ settings }),
      });
      onSaved(settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Personal room settings">
      <div className="flex flex-col gap-4">
        <Toggle
          label="Waiting room"
          description="Guests wait for you to admit them before joining"
          checked={settings.waitingRoomEnabled}
          onChange={(v) => setSettings((s) => ({ ...s, waitingRoomEnabled: v }))}
        />
        <Toggle
          label="Chat"
          description="Allow in-meeting chat"
          checked={settings.allowChat}
          onChange={(v) => setSettings((s) => ({ ...s, allowChat: v }))}
        />
        <Toggle
          label="Recording"
          description="Allow starting a recording"
          checked={settings.allowRecording}
          onChange={(v) => setSettings((s) => ({ ...s, allowRecording: v }))}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-3 hover:bg-surface-field">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="block text-xs text-ink-muted">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? "bg-brand-500" : "bg-surface-chip"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-5" : "left-0.5"}`}
        />
      </button>
    </label>
  );
}
