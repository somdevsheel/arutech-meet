"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface InvitePreview {
  orgName: string;
  inviterName: string;
  email: string;
  status: string;
  expired: boolean;
}

/** The real destination behind the accept-link a real email sends
 * (MailService.sendOrganizationInvite) — works whether the visitor already
 * has an account or not. Unauthenticated visitors are routed through
 * login/register first (redirect= carries them straight back here), then
 * the actual accept call only ever succeeds if the now-authenticated
 * account's email matches this invite's email exactly — see
 * OrganizationsService.acceptInvite. */
export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { user, accessToken, hasHydrated } = useAuthStore();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    apiFetch<InvitePreview>(`/organizations/invites/${token}/preview`, { skipAuth: true })
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "This invite link isn't valid."));
  }, [token]);

  async function accept() {
    setAccepting(true);
    setAcceptError(null);
    try {
      const membership = await apiFetch<{ orgId: string }>(`/organizations/invites/${token}/accept`, {
        method: "POST",
      });
      setAccepted(true);
      setTimeout(() => router.push(`/organizations/${membership.orgId}`), 1200);
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  }

  if (!hasHydrated || (!preview && !loadError)) {
    return <main className="flex min-h-screen items-center justify-center px-6 text-sm text-ink-muted">Loading…</main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-surface-border bg-surface-raised p-6 text-center">
        {loadError && <p className="text-sm text-danger">{loadError}</p>}

        {preview && !loadError && (
          <>
            <h1 className="text-lg font-semibold text-white">
              {preview.inviterName} invited you to join {preview.orgName}
            </h1>
            <p className="mt-1.5 text-xs text-ink-muted">Sent to {preview.email}</p>

            {preview.status !== "PENDING" ? (
              <p className="mt-4 text-sm text-warn">This invite has already been {preview.status.toLowerCase()}.</p>
            ) : preview.expired ? (
              <p className="mt-4 text-sm text-warn">This invite has expired — ask {preview.inviterName} to resend it.</p>
            ) : accepted ? (
              <p className="mt-4 text-sm text-success">You&apos;re in! Taking you to the organization…</p>
            ) : user && accessToken ? (
              <div className="mt-4 flex flex-col gap-2">
                {user.email.toLowerCase() !== preview.email.toLowerCase() && (
                  <p className="text-xs text-warn">
                    You&apos;re signed in as {user.email}, but this invite was sent to {preview.email}.
                  </p>
                )}
                <button
                  onClick={accept}
                  disabled={accepting}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {accepting ? "Joining…" : `Accept as ${user.email}`}
                </button>
                {acceptError && <p className="text-xs text-danger">{acceptError}</p>}
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href={`/login?redirect=${encodeURIComponent(`/organizations/invites/${token}`)}`}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Log in to accept
                </Link>
                <Link
                  href={`/register?redirect=${encodeURIComponent(`/organizations/invites/${token}`)}&email=${encodeURIComponent(preview.email)}`}
                  className="rounded-lg bg-surface-chip px-4 py-2 text-sm font-medium text-ink-2 hover:brightness-110"
                >
                  Create an account to accept
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
