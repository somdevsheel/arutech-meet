"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface FeatureEngagement {
  windowDays: number;
  totalMeetings: number;
  whiteboard: { meetingsUsed: number; adoptionRate: number; totalCreated: number };
  polls: { meetingsUsed: number; adoptionRate: number; totalPublished: number; totalResponses: number; avgResponsesPerPoll: number };
  quizzes: { meetingsUsed: number; adoptionRate: number; totalPublished: number; totalAnswers: number; avgAnswersPerQuiz: number };
  breakoutRooms: { meetingsUsed: number; adoptionRate: number; totalCreated: number };
  recording: { meetingsUsed: number; adoptionRate: number };
  liveCaptions: { meetingsUsed: number; adoptionRate: number; totalStarts: number };
}

const WINDOWS = [7, 30, 90];

/** Per-feature engagement — deliberately distinct from the Dashboard's
 * aggregate counts (which answer "how much exists"), this answers "what
 * fraction of meetings actually used feature X". Every number is a plain
 * aggregate over tables each feature already had for its own real reason —
 * see AdminAnalyticsService's own doc comment for exactly what's counted
 * and, just as deliberately, what isn't. */
export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<FeatureEngagement | null>(null);

  useEffect(() => {
    apiFetch<FeatureEngagement>(`/admin/analytics?days=${days}`).then(setData);
  }, [days]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-white">Feature engagement</h1>
          <p className="text-sm text-ink-muted">
            What fraction of meetings actually used each feature — not just how many rows exist. See
            docs/roadmap.md for why exactly these six and nothing else.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-chip p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                days === w ? "bg-brand-500 text-white" : "text-ink-3 hover:text-white"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <p className="mb-4 text-xs text-ink-muted">
            {data.totalMeetings} meeting{data.totalMeetings === 1 ? "" : "s"} created in the last {data.windowDays}{" "}
            days.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              label="Whiteboard"
              adoptionRate={data.whiteboard.adoptionRate}
              meetingsUsed={data.whiteboard.meetingsUsed}
              totalMeetings={data.totalMeetings}
              extra={[`${data.whiteboard.totalCreated} whiteboard${data.whiteboard.totalCreated === 1 ? "" : "s"} created`]}
            />
            <FeatureCard
              label="Polls"
              adoptionRate={data.polls.adoptionRate}
              meetingsUsed={data.polls.meetingsUsed}
              totalMeetings={data.totalMeetings}
              extra={[
                `${data.polls.totalPublished} published, ${data.polls.totalResponses} responses`,
                `${data.polls.avgResponsesPerPoll} avg responses/poll`,
              ]}
            />
            <FeatureCard
              label="Quizzes"
              adoptionRate={data.quizzes.adoptionRate}
              meetingsUsed={data.quizzes.meetingsUsed}
              totalMeetings={data.totalMeetings}
              extra={[
                `${data.quizzes.totalPublished} published, ${data.quizzes.totalAnswers} answers`,
                `${data.quizzes.avgAnswersPerQuiz} avg answers/quiz`,
              ]}
            />
            <FeatureCard
              label="Breakout rooms"
              adoptionRate={data.breakoutRooms.adoptionRate}
              meetingsUsed={data.breakoutRooms.meetingsUsed}
              totalMeetings={data.totalMeetings}
              extra={[`${data.breakoutRooms.totalCreated} room${data.breakoutRooms.totalCreated === 1 ? "" : "s"} created`]}
            />
            <FeatureCard
              label="Recording"
              adoptionRate={data.recording.adoptionRate}
              meetingsUsed={data.recording.meetingsUsed}
              totalMeetings={data.totalMeetings}
            />
            <FeatureCard
              label="Live captions"
              adoptionRate={data.liveCaptions.adoptionRate}
              meetingsUsed={data.liveCaptions.meetingsUsed}
              totalMeetings={data.totalMeetings}
              extra={[`${data.liveCaptions.totalStarts} start${data.liveCaptions.totalStarts === 1 ? "" : "s"}`]}
            />
          </div>
        </>
      )}
    </div>
  );
}

function FeatureCard({
  label,
  adoptionRate,
  meetingsUsed,
  totalMeetings,
  extra,
}: {
  label: string;
  adoptionRate: number;
  meetingsUsed: number;
  totalMeetings: number;
  extra?: string[];
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-2xl font-semibold text-brand-300">{adoptionRate}%</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-chip">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(adoptionRate, 100)}%` }} />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {meetingsUsed} of {totalMeetings} meeting{totalMeetings === 1 ? "" : "s"}
      </p>
      {extra?.map((line) => (
        <p key={line} className="mt-0.5 text-[11px] text-ink-muted2">
          {line}
        </p>
      ))}
    </div>
  );
}
