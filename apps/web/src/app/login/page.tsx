"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginSchema } from "@arutech/validation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<{
        user: { id: string; email: string; displayName: string; username: string; avatarUrl: string | null; systemRole: string };
        accessToken: string;
        refreshToken: string;
      }>("/auth/login", { method: "POST", body: JSON.stringify(parsed.data), skipAuth: true });
      setSession(res.user, res.accessToken, res.refreshToken);
      router.push(searchParams.get("redirect") || "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-white">Sign in</h1>

        <label className="block space-y-1.5">
          <span className="text-sm text-slate-300">Email</span>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-slate-300">Password</span>
          <input
            type="password"
            className="input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-sm text-slate-400">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-brand-300 hover:text-brand-200">
            Create one
          </Link>
        </p>
      </form>
    </main>
  );
}

// `useSearchParams()` above opts this page out of static rendering unless
// it's wrapped in Suspense — same fix already applied to chat/page.tsx's
// TeamChatPageWrapper; `next build`'s static prerendering enforces this even
// though `next dev` never surfaces it, which is why this only ever showed up
// building a real production image (see docs/deployment-lightsail.md).
export default function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
