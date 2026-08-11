"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/meetings", label: "Meetings" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/recordings", label: "Recordings" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
];

/**
 * Client-side gating here is UX only (hide the admin shell from people who can't
 * use it, redirect them out) — the real authorization boundary is
 * SystemAdminGuard on every /admin/* API route. Every page under this layout
 * calls the API with the user's own access token; a non-admin token gets a 403
 * from the server regardless of what this layout renders.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, accessToken } = useAuthStore();

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (user && user.systemRole !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [user, accessToken, router]);

  if (!user || user.systemRole !== "ADMIN") return null;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-surface-border bg-surface-raised p-4">
        <Link href="/dashboard" className="mb-6 block text-sm text-slate-400 hover:text-white">
          ← Back to app
        </Link>
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Admin</p>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm ${
                pathname === item.href
                  ? "bg-brand-500 text-white"
                  : "text-slate-300 hover:bg-surface-border hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
