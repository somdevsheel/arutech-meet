"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";

interface PollOption {
  id: string;
  text: string;
  order: number;
}

interface Poll {
  id: string;
  question: string;
  isMultipleChoice: boolean;
  status: "DRAFT" | "OPEN" | "CLOSED";
  options: PollOption[];
}

interface PollResult {
  optionId: string;
  text: string;
  votes: number;
}

export function PollsPanel({
  meetingId,
  socket,
  canCreate,
}: {
  meetingId: string;
  socket: Socket | null;
  canCreate: boolean;
}) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [results, setResults] = useState<Record<string, PollResult[]>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Poll[]>(`/meetings/${meetingId}/polls`).then(setPolls);
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onPublished = (p: Poll) => setPolls((prev) => [p, ...prev]);
    const onResponse = (p: { pollId: string; results?: PollResult[] }) => {
      if (p.results) setResults((prev) => ({ ...prev, [p.pollId]: p.results! }));
    };
    const onClosed = (p: { pollId: string; results: PollResult[] }) => {
      setResults((prev) => ({ ...prev, [p.pollId]: p.results }));
      setPolls((prev) => prev.map((poll) => (poll.id === p.pollId ? { ...poll, status: "CLOSED" } : poll)));
    };
    socket.on(WS_EVENTS.POLL_PUBLISHED, onPublished);
    socket.on(WS_EVENTS.POLL_RESPONSE, onResponse);
    socket.on(WS_EVENTS.POLL_CLOSED, onClosed);
    return () => {
      socket.off(WS_EVENTS.POLL_PUBLISHED, onPublished);
      socket.off(WS_EVENTS.POLL_RESPONSE, onResponse);
      socket.off(WS_EVENTS.POLL_CLOSED, onClosed);
    };
  }, [socket]);

  async function createPoll() {
    // L-3: this used to just `return` here — a click that visibly did
    // nothing at all, no error text, no indication anything had even
    // registered. Same missing-feedback gap QuizPanel's own createQuiz had.
    setCreateError(null);
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) {
      setCreateError("Enter a question first.");
      return;
    }
    if (cleanOptions.length < 2) {
      setCreateError("Add at least 2 options.");
      return;
    }
    setCreating(true);
    try {
      await apiFetch(`/meetings/${meetingId}/polls`, {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          options: cleanOptions,
          isMultipleChoice: multi,
          showResultsToParticipants: true,
        }),
      });
      setQuestion("");
      setOptions(["", ""]);
      setMulti(false);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to publish poll");
    } finally {
      setCreating(false);
    }
  }

  async function respond(poll: Poll) {
    const optionIds = [...(selected[poll.id] ?? [])];
    if (optionIds.length === 0) return;
    await apiFetch(`/meetings/${meetingId}/polls/${poll.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ optionIds }),
    });
  }

  async function closePoll(pollId: string) {
    await apiFetch(`/meetings/${meetingId}/polls/${pollId}/close`, { method: "POST" });
  }

  function toggleOption(pollId: string, optionId: string, multiple: boolean) {
    setSelected((prev) => {
      const set = new Set(multiple ? (prev[pollId] ?? []) : []);
      if (set.has(optionId)) set.delete(optionId);
      else if (multiple) set.add(optionId);
      else set.add(optionId);
      return { ...prev, [pollId]: set };
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {canCreate && (
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-raised/50 p-3">
          <p className="text-xs font-medium uppercase text-ink-muted">New poll</p>
          <input
            className="input"
            placeholder="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          {options.map((opt, i) => (
            <input
              key={i}
              className="input"
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => setOptions((prev) => prev.map((o, oi) => (oi === i ? e.target.value : o)))}
            />
          ))}
          <div className="flex items-center justify-between">
            <button onClick={() => setOptions((prev) => [...prev, ""])} className="text-xs text-brand-300">
              + Add option
            </button>
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
              Multiple choice
            </label>
          </div>
          {createError && <p className="text-xs text-danger">{createError}</p>}
          <button
            onClick={createPoll}
            disabled={creating}
            className="w-full rounded bg-brand-500 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {creating ? "Publishing…" : "Publish poll"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {polls.length === 0 && <p className="text-xs text-ink-muted">No polls yet.</p>}
        {polls.map((poll) => {
          const pollResults = results[poll.id];
          const totalVotes = pollResults?.reduce((s, r) => s + r.votes, 0) ?? 0;
          return (
            <div key={poll.id} className="rounded-lg border border-surface-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-white">{poll.question}</p>
                {canCreate && poll.status === "OPEN" && (
                  <button onClick={() => closePoll(poll.id)} className="text-xs text-danger">
                    Close
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {poll.options.map((opt) => {
                  const result = pollResults?.find((r) => r.optionId === opt.id);
                  const pct = totalVotes > 0 && result ? Math.round((result.votes / totalVotes) * 100) : 0;
                  const isSelected = selected[poll.id]?.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      disabled={poll.status !== "OPEN"}
                      onClick={() => toggleOption(poll.id, opt.id, poll.isMultipleChoice)}
                      className={`relative w-full overflow-hidden rounded border px-2 py-1.5 text-left text-xs ${isSelected ? "border-brand-500" : "border-surface-border"}`}
                    >
                      {pollResults && (
                        <div
                          className="absolute inset-y-0 left-0 bg-brand-500/20"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      <span className="relative text-ink-2">
                        {opt.text} {pollResults && `— ${result?.votes ?? 0} (${pct}%)`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {poll.status === "OPEN" && (
                <button
                  onClick={() => respond(poll)}
                  className="mt-2 rounded bg-brand-500 px-3 py-1 text-xs font-medium text-white"
                >
                  Submit
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
