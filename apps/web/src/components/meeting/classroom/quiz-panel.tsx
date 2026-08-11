"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";

interface QuizOption {
  id: string;
  text: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  points: number;
  timerSeconds: number | null;
  options: QuizOption[];
}

interface Quiz {
  id: string;
  title: string;
  questions: QuizQuestion[];
}

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  score: number;
}

/**
 * MVP quiz authoring is one question at a time (the backend/schema support
 * multi-question quizzes — POST /quizzes accepts `questions: [...]` — this UI
 * just always sends an array of length 1 for a fast "ask a quick question"
 * flow, which is what section 15's live-classroom use case actually needs).
 */
export function QuizPanel({
  meetingId,
  socket,
  canCreate,
}: {
  meetingId: string;
  socket: Socket | null;
  canCreate: boolean;
}) {
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [myAnswer, setMyAnswer] = useState<{ optionId: string; isCorrect: boolean } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [closed, setClosed] = useState(false);

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [points, setPoints] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onPublished = (quiz: Quiz) => {
      setActiveQuiz(quiz);
      setClosed(false);
      setMyAnswer(null);
      setLeaderboard(null);
      setAnsweredCount(0);
    };
    const onAnswer = (p: { answeredCount: number }) => setAnsweredCount(p.answeredCount);
    const onClosed = (p: { leaderboard: LeaderboardEntry[] }) => {
      setClosed(true);
      setLeaderboard(p.leaderboard);
    };
    socket.on(WS_EVENTS.QUIZ_PUBLISHED, onPublished);
    socket.on(WS_EVENTS.QUIZ_ANSWER, onAnswer);
    socket.on(WS_EVENTS.QUIZ_CLOSED, onClosed);
    return () => {
      socket.off(WS_EVENTS.QUIZ_PUBLISHED, onPublished);
      socket.off(WS_EVENTS.QUIZ_ANSWER, onAnswer);
      socket.off(WS_EVENTS.QUIZ_CLOSED, onClosed);
    };
  }, [socket]);

  async function createQuiz() {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2) return;
    setCreating(true);
    try {
      await apiFetch(`/meetings/${meetingId}/quizzes`, {
        method: "POST",
        body: JSON.stringify({
          title: question.trim(),
          questions: [
            {
              question: question.trim(),
              points,
              options: cleanOptions.map((text, i) => ({ text, isCorrect: i === correctIndex })),
            },
          ],
        }),
      });
      setQuestion("");
      setOptions(["", "", "", ""]);
      setCorrectIndex(0);
      setPoints(1);
    } finally {
      setCreating(false);
    }
  }

  async function answer(optionId: string) {
    if (!activeQuiz) return;
    const question = activeQuiz.questions[0]!;
    const res = await apiFetch<{ isCorrect: boolean; pointsAwarded: number }>(
      `/meetings/${meetingId}/quizzes/${activeQuiz.id}/questions/${question.id}/answer`,
      { method: "POST", body: JSON.stringify({ selectedOptionId: optionId }) },
    );
    setMyAnswer({ optionId, isCorrect: res.isCorrect });
  }

  async function closeQuiz() {
    if (!activeQuiz) return;
    await apiFetch(`/meetings/${meetingId}/quizzes/${activeQuiz.id}/close`, { method: "POST" });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {canCreate && (
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-raised/50 p-3">
          <p className="text-xs font-medium uppercase text-slate-500">New quiz question</p>
          <input
            className="input"
            placeholder="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                checked={correctIndex === i}
                onChange={() => setCorrectIndex(i)}
                title="Correct answer"
              />
              <input
                className="input"
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((o, oi) => (oi === i ? e.target.value : o)))}
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Points
            <input
              type="number"
              min={1}
              max={100}
              value={points}
              onChange={(e) => setPoints(Number(e.target.value) || 1)}
              className="input w-16"
            />
          </label>
          <button
            onClick={createQuiz}
            disabled={creating}
            className="w-full rounded bg-brand-500 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Publish question
          </button>
        </div>
      )}

      {!activeQuiz && <p className="text-xs text-slate-500">No active quiz question.</p>}

      {activeQuiz && (
        <div className="rounded-lg border border-surface-border p-3">
          <p className="mb-2 text-sm font-medium text-white">{activeQuiz.questions[0]!.question}</p>
          <p className="mb-2 text-xs text-slate-500">{answeredCount} answered</p>

          {!closed && (
            <div className="space-y-1.5">
              {activeQuiz.questions[0]!.options.map((opt) => (
                <button
                  key={opt.id}
                  disabled={Boolean(myAnswer)}
                  onClick={() => answer(opt.id)}
                  className={`w-full rounded border px-2 py-1.5 text-left text-xs text-slate-200 ${
                    myAnswer?.optionId === opt.id
                      ? myAnswer.isCorrect
                        ? "border-green-500 bg-green-500/10"
                        : "border-red-500 bg-red-500/10"
                      : "border-surface-border"
                  }`}
                >
                  {opt.text}
                </button>
              ))}
              {myAnswer && (
                <p className={`text-xs ${myAnswer.isCorrect ? "text-green-400" : "text-red-400"}`}>
                  {myAnswer.isCorrect ? "Correct!" : "Not quite."}
                </p>
              )}
            </div>
          )}

          {canCreate && !closed && (
            <button onClick={closeQuiz} className="mt-2 rounded bg-red-600 px-3 py-1 text-xs text-white">
              Close & show results
            </button>
          )}

          {closed && leaderboard && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium uppercase text-slate-500">Leaderboard</p>
              {leaderboard.length === 0 && <p className="text-xs text-slate-500">No answers submitted.</p>}
              {leaderboard.map((entry, i) => (
                <div key={entry.userId} className="flex justify-between text-xs text-slate-300">
                  <span>
                    {i + 1}. {entry.displayName}
                  </span>
                  <span>{entry.score} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
