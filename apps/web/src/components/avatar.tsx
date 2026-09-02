"use client";

import { useState } from "react";

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

/** M-2: `User.avatarUrl` has existed on the model and been threaded through
 * every profile-shaped type in the app since day one, but nothing ever
 * rendered it as an actual image — every avatar spot just showed initials,
 * so there was no way to see the effect of setting one even after Settings
 * grew a field for it. This is the one place that decides "image or
 * initials", so every avatar spot can share it instead of drifting.
 * Falls back to initials if the URL is missing OR fails to load. */
export function Avatar({
  name,
  avatarUrl,
  size = 32,
  className = "",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (avatarUrl && !failed) {
    // avatarUrl is an arbitrary user-supplied URL, not a static/local asset
    // next/image can optimize, and every one of these renders at a small
    // fixed size, so the perf tradeoff next/image exists for doesn't apply.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`flex-none rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`grid flex-none place-items-center rounded-full bg-brand-500 font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}
