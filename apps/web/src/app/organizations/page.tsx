"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { ModalShell } from "@/components/dashboard/schedule-meeting-modal";
import { FullPageLoading } from "@/components/full-page-loading";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

/** Real, member-facing organizations — distinct from the read-only admin
 * dashboard's /admin/organizations, which only a system admin can see. Any
 * user can create one and invite real people into it by email. */
export default function OrganizationsPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    return apiFetch<OrgSummary[]>("/organizations").then(setOrgs);
  }

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const org = await apiFetch<OrgSummary>("/organizations", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setCreating(false);
      setName("");
      router.push(`/organizations/${org.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create organization");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="organizations"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
            <p className="mt-1 text-[13px] text-ink-muted">Shared workspaces you&apos;re a member of.</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            New organization
          </button>
        </div>

        {orgs === null && <p className="text-sm text-ink-muted">Loading…</p>}
        {orgs?.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-border p-8 text-center text-sm text-ink-muted">
            No organizations yet — create one to invite people and manage shared meeting/storage limits.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orgs?.map((org) => (
            <button
              key={org.id}
              onClick={() => router.push(`/organizations/${org.id}`)}
              className="rounded-xl border border-surface-border bg-surface-raised p-4 text-left hover:border-brand-500"
            >
              <p className="font-medium text-white">{org.name}</p>
              <p className="mt-1 text-xs text-ink-muted">@{org.slug} · {org.plan}</p>
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <ModalShell title="New organization" onClose={() => setCreating(false)}>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Acme Inc." autoFocus />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </ModalShell>
      )}
    </AppShell>
  );
}
