"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordResetSchema } from "@arutech/validation";
import { apiFetch, ApiError } from "@/lib/api-client";

/** M-1: requestPasswordResetSchema already existed in @arutech/validation
 * and the API endpoint it validates against now actually exists — this is
 * the missing front door to both. Always shows the same success message
 * regardless of whether the email matches a real account, mirroring
 * AuthService.requestPasswordReset's own no-enumeration behavior — a
 * different message here would undo the point of that. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = requestPasswordResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify(parsed.data),
        skipAuth: true,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-white">Check your email</h1>
          <p className="text-sm text-slate-400">
            If an account exists for <span className="text-slate-300">{email}</span>, we&apos;ve sent a link to
            reset your password. It expires in 1 hour.
          </p>
          <Link href="/login" className="inline-block text-sm text-brand-300 hover:text-brand-200">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reset your password</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Enter the email on your account and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm text-slate-300">Email</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send reset link"}
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
