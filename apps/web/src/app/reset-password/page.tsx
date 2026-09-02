"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPasswordSchema } from "@arutech/validation";
import { apiFetch, ApiError } from "@/lib/api-client";

/** M-1: the redemption side of ForgotPasswordPage's email. `token` arrives
 * as a plain query param (never a route param) so it never gets logged as
 * part of a path in typical server access logs the way a route segment
 * would. */
function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(parsed.data),
        skipAuth: true,
      });
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-white">Invalid reset link</h1>
          <p className="text-sm text-slate-400">This link is missing its token. Request a new one.</p>
          <Link href="/forgot-password" className="inline-block text-sm text-brand-300 hover:text-brand-200">
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-white">Password reset</h1>
          <p className="text-sm text-slate-400">
            Your password has been changed and you&apos;ve been signed out everywhere else. Taking you to sign
            in…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-white">Set a new password</h1>

        <label className="block space-y-1.5">
          <span className="text-sm text-slate-300">New password</span>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-slate-300">Confirm new password</span>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? "Resetting…" : "Reset password"}
        </button>

        <p className="text-center text-sm text-slate-400">
          <Link href="/login" className="text-brand-300 hover:text-brand-200">
            Back to sign in
          </Link>
        </p>
      </form>
    </main>
  );
}

// Same reason as login/register: useSearchParams() opts this page out of
// static rendering unless wrapped in Suspense, which next build enforces
// even though next dev never surfaces it.
export default function ResetPasswordPageWrapper() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPage />
    </Suspense>
  );
}
