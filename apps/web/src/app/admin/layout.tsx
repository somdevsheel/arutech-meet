"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/meetings", label: "Meetings" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/recordings", label: "Recordings" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
  { href: "/admin/feature-flags", label: "Feature Flags" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/analytics", label: "Analytics" },
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
  const { user, accessToken, clear, hasHydrated } = useAuthStore();

  useEffect(() => {
    // See auth-store.ts: the persisted session hydrates asynchronously, so this
    // must wait for it before treating a fresh page load as "logged out" — a
    // hard refresh on /admin would otherwise always bounce a real admin out.
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (user && user.systemRole !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [hasHydrated, user, accessToken, router]);

  if (!hasHydrated || !user || user.systemRole !== "ADMIN") return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="admin"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <nav className="flex flex-wrap gap-1 border-b border-surface-border pb-3" aria-label="Admin sections">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                pathname === item.href
                  ? "bg-brand-tint2 text-white"
                  : "text-ink-3 hover:bg-surface-elevated hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </AppShell>
  );
}
