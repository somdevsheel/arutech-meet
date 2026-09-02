"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "./schedule-meeting-modal";

interface PersonalRoomSettings {
  waitingRoomEnabled: boolean;
  allowChat: boolean;
  allowRecording: boolean;
  allowedEmailDomains: string[];
}

/** Real settings, backed by the same PATCH /meetings/:id/settings every other
 * meeting uses (MeetingsService.updateSettings) — not personal-room-specific
 * plumbing, just a UI for a knob that already existed. */
export function PersonalRoomSettingsModal({
  meetingId,
  initial,
  requiresPassword,
  onClose,
  onSaved,
}: {
  meetingId: string;
  initial: PersonalRoomSettings;
  /** Whether a password is currently set — the hash itself is never sent to
   * the client (see MeetingsService.sanitizeMeeting), only this boolean. */
  requiresPassword: boolean;
  onClose: () => void;
  onSaved: (settings: PersonalRoomSettings, requiresPassword: boolean) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [domainsText, setDomainsText] = useState(initial.allowedEmailDomains.join(", "));
  // H-11: meeting passwords were fully built and enforced server-side but
  // completely unreachable from any UI — this (and the same field in the
  // Schedule modal) is the actual fix. Blank means "leave the current
  // password as-is" (PATCH treats an omitted `password` that way — see
  // MeetingsService.updateSettings); typing something changes it.
  // "Remove password" is a real, separate limitation the API itself doesn't
  // support yet (there's no way to send "clear it" vs "don't touch it"),
  // called out in that same method's own comment — not something this UI
  // can paper over.
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const allowedEmailDomains = domainsText
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const next = { ...settings, allowedEmailDomains };
      await apiFetch(`/meetings/${meetingId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: next,
          password: password.trim() || undefined,
        }),
      });
      onSaved(next, password.trim() ? true : requiresPassword);
      setPassword("");
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

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white">
            Meeting password {requiresPassword && <span className="font-normal text-success">(currently set)</span>}
          </span>
          <span className="text-xs text-ink-muted">
            {requiresPassword
              ? "Leave blank to keep the current password, or enter a new one to change it."
              : "Leave blank for no password."}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={requiresPassword ? "New password" : "e.g. lets-meet-2026"}
            className="input"
            autoComplete="new-password"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white">Restrict by email domain</span>
          <span className="text-xs text-ink-muted">
            Comma-separated domains (e.g. acme.com, partner.org). Empty = anyone can join. You&rsquo;re always
            exempt from your own restriction.
          </span>
          <input
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            placeholder="e.g. acme.com"
            className="input"
          />
        </label>

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

export function Toggle({
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
