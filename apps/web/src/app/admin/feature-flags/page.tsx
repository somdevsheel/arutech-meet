"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminOrgOption {
  id: string;
  name: string;
}

interface FeatureFlagRow {
  id: string;
  key: string;
  enabled: boolean;
  organizationId: string | null;
  description: string | null;
  organization: { id: string; name: string } | null;
}

/** Real, server-enforced feature flags — not a UI-only toggle. Three flags
 * are actually wired to a gate today (WHITEBOARD, BREAKOUT_ROOMS,
 * LIVE_CAPTIONS — see FeatureFlagsService and each's own service), but any
 * key can be created here; it just has no effect until some service checks
 * it. A key with no row at all defaults to enabled — this page only ever
 * needs to create a row to turn something *off*. */
export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlagRow[]>([]);
  const [knownKeys, setKnownKeys] = useState<string[]>([]);
  const [orgs, setOrgs] = useState<AdminOrgOption[]>([]);
  const [newKey, setNewKey] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addingOverrideFor, setAddingOverrideFor] = useState<string | null>(null);
  const [overrideOrgId, setOverrideOrgId] = useState("");

  function refresh() {
    return apiFetch<{ flags: FeatureFlagRow[]; knownKeys: string[] }>("/admin/feature-flags").then((data) => {
      setFlags(data.flags);
      setKnownKeys(data.knownKeys);
    });
  }

  useEffect(() => {
    refresh();
    apiFetch<{ organizations: AdminOrgOption[] }>("/admin/organizations?take=100&skip=0")
      .then((data) => setOrgs(data.organizations))
      .catch(() => setOrgs([]));
  }, []);

  // Every key that has at least one row, plus every known-wired key even if
  // it has none yet (so WHITEBOARD/BREAKOUT_ROOMS/LIVE_CAPTIONS always show,
  // defaulting to "Enabled" with no row behind that yet).
  const allKeys = [...new Set([...knownKeys, ...flags.map((f) => f.key)])].sort();

  async function setGlobal(key: string, enabled: boolean) {
    setBusyKey(key);
    try {
      await apiFetch(`/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function setOverride(key: string, orgId: string, enabled: boolean) {
    setBusyKey(`${key}:${orgId}`);
    try {
      await apiFetch(`/admin/feature-flags/${encodeURIComponent(key)}/organizations/${orgId}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function removeOverride(key: string, orgId: string) {
    setBusyKey(`${key}:${orgId}`);
    try {
      await apiFetch(`/admin/feature-flags/${encodeURIComponent(key)}/organizations/${orgId}`, {
        method: "DELETE",
      });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function addCustomKey() {
    const key = newKey.trim().toUpperCase().replace(/\s+/g, "_");
    if (!key) return;
    await setGlobal(key, true);
    setNewKey("");
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-white">Feature Flags</h1>
      <p className="mb-6 text-sm text-ink-muted">
        A flag with no row at all is enabled by default. Only three keys are actually wired to a real
        server-side gate today: <code className="text-ink-2">WHITEBOARD</code>,{" "}
        <code className="text-ink-2">BREAKOUT_ROOMS</code>, <code className="text-ink-2">LIVE_CAPTIONS</code>.
      </p>

      <div className="mb-6 flex items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">New flag key</span>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="e.g. AI_TRANSCRIPTION"
            className="input w-64"
          />
        </label>
        <button
          onClick={addCustomKey}
          disabled={!newKey.trim()}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {allKeys.map((key) => {
          const global = flags.find((f) => f.key === key && f.organizationId === null);
          const overrides = flags.filter((f) => f.key === key && f.organizationId !== null);
          const globalEnabled = global?.enabled ?? true;
          const isWired = knownKeys.includes(key);

          return (
            <div key={key} className="rounded-xl border border-surface-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm text-white">{key}</span>
                  {!isWired && (
                    <span className="ml-2 rounded-full bg-surface-chip px-2 py-0.5 text-[10px] text-ink-muted">
                      not wired to any gate
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setGlobal(key, !globalEnabled)}
                  disabled={busyKey === key}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    globalEnabled ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                  } disabled:opacity-50`}
                >
                  {globalEnabled ? "Enabled" : "Disabled"} globally
                </button>
              </div>

              {overrides.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {overrides.map((o) => (
                    <li key={o.organizationId} className="flex items-center justify-between rounded-lg bg-surface-field px-3 py-1.5 text-xs">
                      <span className="text-ink-2">{o.organization?.name ?? o.organizationId}</span>
                      <span className="flex items-center gap-2">
                        <button
                          onClick={() => setOverride(key, o.organizationId as string, !o.enabled)}
                          disabled={busyKey === `${key}:${o.organizationId}`}
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            o.enabled ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                          } disabled:opacity-50`}
                        >
                          {o.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          onClick={() => removeOverride(key, o.organizationId as string)}
                          disabled={busyKey === `${key}:${o.organizationId}`}
                          className="text-ink-muted hover:text-danger"
                        >
                          Remove override
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {addingOverrideFor === key ? (
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={overrideOrgId}
                    onChange={(e) => setOverrideOrgId(e.target.value)}
                    className="input flex-1"
                  >
                    <option value="">Select an organization…</option>
                    {orgs
                      .filter((o) => !overrides.some((ov) => ov.organizationId === o.id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={async () => {
                      if (!overrideOrgId) return;
                      await setOverride(key, overrideOrgId, !globalEnabled);
                      setAddingOverrideFor(null);
                      setOverrideOrgId("");
                    }}
                    disabled={!overrideOrgId}
                    className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
                  >
                    Add override ({globalEnabled ? "disable" : "enable"} for them)
                  </button>
                  <button onClick={() => setAddingOverrideFor(null)} className="text-xs text-ink-muted hover:text-white">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingOverrideFor(key)}
                  className="mt-3 text-xs font-medium text-brand-300 hover:underline"
                >
                  + Override for one organization
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
