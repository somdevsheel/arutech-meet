"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AuthUser } from "@/lib/auth-store";
import { useNotifications } from "@/hooks/use-notifications";
import { apiFetch } from "@/lib/api-client";
import { CallOverlay } from "@/components/calls/call-overlay";

export type ActiveNav = "home" | "calendar" | "classes" | "courses" | "chat" | "contacts" | "recordings" | "notes" | "apps" | "admin";

export interface AppShellProps {
  user: AuthUser;
  active: ActiveNav;
  accessToken: string | null;
  onSignOut: () => void;
  rail?: React.ReactNode;
  children: React.ReactNode;
}

function initialsOf(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

interface SearchResults {
  meetings: { id: string; code: string; title: string; status: string }[];
  contacts: { id: string; displayName: string; username: string; avatarUrl: string | null }[];
  notes: { id: string; title: string }[];
}

/** Shared authenticated-app chrome: a left nav sidebar + a top bar with real
 * search, a real notification bell, and an account menu. Every sidebar link
 * and topbar affordance goes to something real — no placeholder nav items. */
export function AppShell({ user, active, accessToken, onSignOut, rail, children }: AppShellProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(accessToken);
  const chatUnreadCount = notifications.filter((n) => n.type === "CHAT_MESSAGE" && !n.readAt).length;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const hasResults =
    results && (results.meetings.length > 0 || results.contacts.length > 0 || results.notes.length > 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-16 flex-none items-center gap-6 border-b border-surface-border bg-surface-raised px-6">
        <Link href="/dashboard" className="flex flex-none items-center gap-2.5 text-base font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm14 3.2 3.4-2.4a1 1 0 0 1 1.6.8v6.8a1 1 0 0 1-1.6.8L17 13.8v-3.6Z" />
            </svg>
          </span>
          Arutech Meet
        </Link>

        <div className="relative hidden max-w-md flex-1 sm:block">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search meetings, people, notes"
            className="h-9 w-full rounded-lg border border-surface-border2 bg-surface-field pl-9 pr-3 text-xs text-ink-2 outline-none placeholder:text-ink-muted2 focus:border-brand-500"
          />
          {searchOpen && query.trim().length >= 2 && (
            <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-surface-border bg-surface-raised py-1.5 shadow-xl">
              {!results && <p className="px-3 py-2 text-xs text-ink-muted">Searching…</p>}
              {results && !hasResults && <p className="px-3 py-2 text-xs text-ink-muted">No results for &ldquo;{query}&rdquo;.</p>}
              {results && results.meetings.length > 0 && (
                <SearchGroup label="Meetings">
                  {results.meetings.map((m) => (
                    <SearchRow key={m.id} onClick={() => router.push(`/meeting/${m.code}`)} title={m.title} subtitle={`${m.code} · ${m.status}`} />
                  ))}
                </SearchGroup>
              )}
              {results && results.contacts.length > 0 && (
                <SearchGroup label="People">
                  {results.contacts.map((c) => (
                    <SearchRow key={c.id} onClick={() => router.push("/contacts")} title={c.displayName} subtitle={`@${c.username}`} />
                  ))}
                </SearchGroup>
              )}
              {results && results.notes.length > 0 && (
                <SearchGroup label="Notes">
                  {results.notes.map((n) => (
                    <SearchRow key={n.id} onClick={() => router.push("/notes")} title={n.title} />
                  ))}
                </SearchGroup>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex flex-none items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Notifications"
              className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-field hover:text-ink-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
                <path d="M13.7 20a2 2 0 0 1-3.4 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-surface-border bg-surface-raised shadow-xl">
                  <div className="flex items-center justify-between border-b border-surface-border px-3 py-2.5">
                    <p className="text-sm font-semibold">Notifications</p>
                    {unreadCount > 0 && (
                      <button onClick={() => markAllRead()} className="text-xs font-medium text-brand-300 hover:underline">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-ink-muted">No notifications yet.</p>
                    )}
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (!n.readAt) markRead(n.id);
                          setNotifOpen(false);
                          const data = n.data as { meetingCode?: string; chatRoomId?: string } | null;
                          if (n.type === "CALL_INCOMING" && data?.meetingCode) {
                            router.push(`/meeting/${data.meetingCode}`);
                          } else if (n.type === "RECORDING_READY") {
                            router.push("/recordings");
                          } else if (n.type === "CHAT_MESSAGE" && data?.chatRoomId) {
                            router.push(`/chat?room=${data.chatRoomId}`);
                          }
                        }}
                        className={`block w-full border-b border-surface-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-surface-field ${!n.readAt ? "bg-brand-tint3" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink-2">{n.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <Link
            href="/settings"
            aria-label="Settings"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-field hover:text-ink-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" />
            </svg>
          </Link>

          <div className="relative ml-1">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-field"
            >
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                {initialsOf(user.displayName)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-semibold leading-tight">{user.displayName}</span>
                <span className="block text-[10px] leading-tight text-ink-muted">
                  {user.systemRole === "ADMIN" ? "Administrator" : `@${user.username}`}
                </span>
              </span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-surface-border bg-surface-raised py-1 shadow-xl">
                  <div className="border-b border-surface-border px-3 py-2">
                    <p className="truncate text-sm font-medium text-white">{user.displayName}</p>
                    <p className="truncate text-xs text-ink-muted">{user.email}</p>
                  </div>
                  <Link
                    href="/settings"
                    className="block w-full px-3 py-2 text-left text-sm text-ink-3 hover:bg-surface-field hover:text-white"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={onSignOut}
                    className="w-full px-3 py-2 text-left text-sm text-ink-3 hover:bg-surface-field hover:text-white"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className="hidden w-[230px] flex-none flex-col gap-1 overflow-y-auto border-r border-surface-border bg-surface-sunken p-3 md:flex"
        >
          <SidebarLink href="/dashboard" label="Home" active={active === "home"}>
            <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            <path d="M9 21v-8h6v8" />
          </SidebarLink>
          <SidebarLink href="/calendar" label="Calendar" active={active === "calendar"}>
            <rect x="3" y="4.5" width="18" height="16" rx="2" />
            <path d="M3 9.5h18M8 3v3M16 3v3" />
          </SidebarLink>
          <SidebarLink href="/classes" label="Classes" active={active === "classes"}>
            <path d="M12 3 2 8l10 5 10-5-10-5Z" />
            <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
          </SidebarLink>
          <SidebarLink href="/courses" label="Courses" active={active === "courses"}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
          </SidebarLink>
          <SidebarLink href="/chat" label="Team Chat" active={active === "chat"} badge={chatUnreadCount}>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.2A8 8 0 1 1 21 12Z" />
          </SidebarLink>
          <SidebarLink href="/contacts" label="Contacts" active={active === "contacts"}>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3 20a6 6 0 0 1 12 0" />
            <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.6 5.6 0 0 0-2-4" />
          </SidebarLink>
          <SidebarLink href="/recordings" label="Recordings" active={active === "recordings"}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3.2" />
          </SidebarLink>

          <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Workspace
          </p>

          <SidebarLink href="/notes" label="Notes" active={active === "notes"}>
            <path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
            <path d="M8 12h8M8 16h5" />
          </SidebarLink>
          <SidebarLink href="/apps" label="Apps" active={active === "apps"}>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </SidebarLink>

          {user.systemRole === "ADMIN" && (
            <SidebarLink href="/admin" label="Admin" active={active === "admin"}>
              <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z" />
            </SidebarLink>
          )}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-7 md:px-8">{children}</main>

        {rail && (
          <aside className="hidden w-[320px] flex-none flex-col gap-4 overflow-y-auto border-l border-surface-border bg-surface-sunken p-5 xl:flex">
            {rail}
          </aside>
        )}
      </div>
      <CallOverlay accessToken={accessToken} />
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      {children}
    </div>
  );
}

function SearchRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-surface-field">
      <p className="truncate text-xs font-medium text-ink-2">{title}</p>
      {subtitle && <p className="truncate text-[10px] text-ink-muted">{subtitle}</p>}
    </button>
  );
}

function SidebarLink({
  href,
  label,
  active,
  badge,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
        active ? "bg-brand-tint2 text-white" : "text-ink-3 hover:bg-surface-elevated hover:text-white"
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={active ? "text-brand-300" : "text-ink-muted2"}
      >
        {children}
      </svg>
      {label}
      {!!badge && (
        <span className="ml-auto grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}
