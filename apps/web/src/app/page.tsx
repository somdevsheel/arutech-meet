"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white">Arutech Meet</h1>
        <p className="mt-3 max-w-md text-surface-border text-slate-400">
          Video meetings, online classrooms, and calls in one platform.
        </p>
      </div>

      <form
        className="flex w-full max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/meeting/${code.trim()}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter a meeting code"
          className="flex-1 rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5 text-sm text-white outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Join
        </button>
      </form>

      <div className="flex gap-4 text-sm">
        <Link href="/login" className="text-brand-300 hover:text-brand-200">
          Sign in
        </Link>
        <span className="text-slate-600">·</span>
        <Link href="/register" className="text-brand-300 hover:text-brand-200">
          Create account
        </Link>
      </div>
    </main>
  );
}
