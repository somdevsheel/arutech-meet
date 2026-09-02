"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface AppTile {
  href: string;
  title: string;
  description: string;
  tone: "brand" | "success" | "warn" | "accent";
  icon: React.ReactNode;
}

const APPS: AppTile[] = [
  {
    href: "/classes",
    title: "Classes",
    description: "Teach live sessions with attendance, whiteboard, polls, and quizzes.",
    tone: "brand",
    icon: (
      <>
        <path d="M12 3 2 8l10 5 10-5-10-5Z" />
        <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
      </>
    ),
  },
  {
    href: "/recordings",
    title: "Recordings",
    description: "Every meeting recording that's finished processing.",
    tone: "success",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    ),
  },
  {
    href: "/notes",
    title: "Notes",
    description: "Personal notes, private to you.",
    tone: "warn",
    icon: (
      <>
        <path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M8 12h8M8 16h5" />
      </>
    ),
  },
  {
    href: "/chat",
    title: "Team Chat",
    description: "Standing group and direct conversations outside any meeting.",
    tone: "accent",
    icon: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.2A8 8 0 1 1 21 12Z" />,
  },
  {
    href: "/contacts",
    title: "Contacts",
    description: "Everyone you've shared a meeting with.",
    tone: "brand",
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
      </>
    ),
  },
];

const TONE_CLASSES: Record<AppTile["tone"], string> = {
  brand: "bg-brand-tint text-brand-300",
  success: "bg-success-bg text-success",
  warn: "bg-warn-bg text-warn",
  accent: "bg-accent-bg text-accent",
};

export default function AppsPage() {
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="apps"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
            A launcher for what&rsquo;s actually built into Arutech Meet — not a third-party integration
            marketplace (there are no external app integrations to install here yet).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app) => (
            <Link
              key={app.href}
              href={app.href}
              className="flex flex-col items-start gap-3 rounded-xl border border-surface-border bg-surface-raised p-[18px] transition hover:-translate-y-0.5 hover:border-surface-border2"
            >
              <span className={`grid h-[42px] w-[42px] place-items-center rounded-lg ${TONE_CLASSES[app.tone]}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {app.icon}
                </svg>
              </span>
              <span>
                <span className="block text-sm font-semibold">{app.title}</span>
                <span className="mt-0.5 block text-[11px] text-ink-muted">{app.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
