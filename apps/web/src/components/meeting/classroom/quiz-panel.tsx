"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";

type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";

interface QuizOption {
  id: string;
  text: string;
}

interface QuizQuestion {
  id: string;
  type: QuestionType;
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

interface CloseResult {
  questionId: string;
  question: string;
  type: QuestionType;
  correctOptionId: string | null;
  options: { id: string; text: string; isCorrect: boolean }[];
  correctAnswerText: string | null;
}

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  TRUE_FALSE: "True / False",
  SHORT_ANSWER: "Short answer",
};

/**
 * MVP quiz authoring is one question at a time (the backend/schema support
 * multi-question quizzes — POST /quizzes accepts `questions: [...]` — this UI
 * just always sends an array of length 1 for a fast "ask a quick question"
 * flow, which is what section 15's live-classroom use case actually needs).
 * Three question types: multiple choice (the original), true/false and short
 * answer (both new) — see the schema comment on `QuizQuestionType` for how
 * each is graded server-side.
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
  const [myAnswer, setMyAnswer] = useState<{ optionId?: string; answerText?: string; isCorrect: boolean } | null>(
    null,
  );
  const [shortAnswerDraft, setShortAnswerDraft] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [closedResults, setClosedResults] = useState<CloseResult[] | null>(null);
  const [closed, setClosed] = useState(false);

  const [questionType, setQuestionType] = useState<QuestionType>("MULTIPLE_CHOICE");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [trueFalseAnswer, setTrueFalseAnswer] = useState(true);
  const [shortAnswerCorrect, setShortAnswerCorrect] = useState("");
  const [points, setPoints] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onPublished = (quiz: Quiz) => {
      setActiveQuiz(quiz);
      setClosed(false);
      setMyAnswer(null);
      setShortAnswerDraft("");
      setLeaderboard(null);
      setClosedResults(null);
      setAnsweredCount(0);
    };
    const onAnswer = (p: { answeredCount: number }) => setAnsweredCount(p.answeredCount);
    const onClosed = (p: { leaderboard: LeaderboardEntry[]; results: CloseResult[] }) => {
      setClosed(true);
      setLeaderboard(p.leaderboard);
      setClosedResults(p.results);
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
    if (!question.trim()) return;
    let body: Record<string, unknown>;
    if (questionType === "MULTIPLE_CHOICE") {
      const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
      if (cleanOptions.length < 2) return;
      body = {
        type: "MULTIPLE_CHOICE",
        question: question.trim(),
        points,
        options: cleanOptions.map((text, i) => ({ text, isCorrect: i === correctIndex })),
      };
    } else if (questionType === "TRUE_FALSE") {
      body = { type: "TRUE_FALSE", question: question.trim(), points, correctAnswer: trueFalseAnswer };
    } else {
      if (!shortAnswerCorrect.trim()) return;
      body = {
        type: "SHORT_ANSWER",
        question: question.trim(),
        points,
        correctAnswerText: shortAnswerCorrect.trim(),
      };
    }

    setCreating(true);
    try {
      await apiFetch(`/meetings/${meetingId}/quizzes`, {
        method: "POST",
        body: JSON.stringify({ title: question.trim(), questions: [body] }),
      });
      setQuestion("");
      setOptions(["", "", "", ""]);
      setCorrectIndex(0);
      setTrueFalseAnswer(true);
      setShortAnswerCorrect("");
      setPoints(1);
    } finally {
      setCreating(false);
    }
  }

  async function answerOption(optionId: string) {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[0]!;
    const res = await apiFetch<{ isCorrect: boolean; pointsAwarded: number }>(
      `/meetings/${meetingId}/quizzes/${activeQuiz.id}/questions/${q.id}/answer`,
      { method: "POST", body: JSON.stringify({ selectedOptionId: optionId }) },
    );
    setMyAnswer({ optionId, isCorrect: res.isCorrect });
  }

  async function answerShortText() {
    if (!activeQuiz || !shortAnswerDraft.trim()) return;
    const q = activeQuiz.questions[0]!;
    const res = await apiFetch<{ isCorrect: boolean; pointsAwarded: number }>(
      `/meetings/${meetingId}/quizzes/${activeQuiz.id}/questions/${q.id}/answer`,
      { method: "POST", body: JSON.stringify({ answerText: shortAnswerDraft.trim() }) },
    );
    setMyAnswer({ answerText: shortAnswerDraft.trim(), isCorrect: res.isCorrect });
  }

  async function closeQuiz() {
    if (!activeQuiz) return;
    await apiFetch(`/meetings/${meetingId}/quizzes/${activeQuiz.id}/close`, { method: "POST" });
  }

  const activeQuestion = activeQuiz?.questions[0];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {canCreate && (
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-raised/50 p-3">
          <p className="text-xs font-medium uppercase text-ink-muted">New quiz question</p>

          <div className="flex gap-1.5">
            {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
              <button
                key={t}
                onClick={() => setQuestionType(t)}
                className={`rounded px-2 py-1 text-[11px] font-medium ${
                  questionType === t ? "bg-brand-500 text-white" : "bg-surface-field text-ink-muted"
                }`}
              >
                {QUESTION_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <input
            className="input"
            placeholder="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />

          {questionType === "MULTIPLE_CHOICE" &&
            options.map((opt, i) => (
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

          {questionType === "TRUE_FALSE" && (
            <div className="flex gap-1.5">
              <button
                onClick={() => setTrueFalseAnswer(true)}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  trueFalseAnswer ? "bg-green-500/20 text-green-400" : "bg-surface-field text-ink-muted"
                }`}
              >
                Correct answer: True
              </button>
              <button
                onClick={() => setTrueFalseAnswer(false)}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  !trueFalseAnswer ? "bg-green-500/20 text-green-400" : "bg-surface-field text-ink-muted"
                }`}
              >
                Correct answer: False
              </button>
            </div>
          )}

          {questionType === "SHORT_ANSWER" && (
            <input
              className="input"
              placeholder="Correct answer (exact match, case-insensitive)"
              value={shortAnswerCorrect}
              onChange={(e) => setShortAnswerCorrect(e.target.value)}
            />
          )}

          <label className="flex items-center gap-2 text-xs text-ink-muted">
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

      {!activeQuiz && <p className="text-xs text-ink-muted">No active quiz question.</p>}

      {activeQuiz && activeQuestion && (
        <div className="rounded-lg border border-surface-border p-3">
          <p className="mb-2 text-sm font-medium text-white">{activeQuestion.question}</p>
          <p className="mb-2 text-xs text-ink-muted">{answeredCount} answered</p>

          {!closed && activeQuestion.type !== "SHORT_ANSWER" && (
            <div className="space-y-1.5">
              {activeQuestion.options.map((opt) => (
                <button
                  key={opt.id}
                  disabled={Boolean(myAnswer)}
                  onClick={() => answerOption(opt.id)}
                  className={`w-full rounded border px-2 py-1.5 text-left text-xs text-ink-2 ${
                    myAnswer?.optionId === opt.id
                      ? myAnswer.isCorrect
                        ? "border-green-500 bg-green-500/10"
                        : "border-danger bg-danger/10"
                      : "border-surface-border"
                  }`}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}

          {!closed && activeQuestion.type === "SHORT_ANSWER" && (
            <div className="flex gap-1.5">
              <input
                className="input flex-1"
                placeholder="Your answer…"
                value={shortAnswerDraft}
                onChange={(e) => setShortAnswerDraft(e.target.value)}
                disabled={Boolean(myAnswer)}
              />
              <button
                onClick={answerShortText}
                disabled={Boolean(myAnswer) || !shortAnswerDraft.trim()}
                className="flex-none rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          )}

          {myAnswer && (
            <p className={`mt-1.5 text-xs ${myAnswer.isCorrect ? "text-green-400" : "text-danger"}`}>
              {myAnswer.isCorrect ? "Correct!" : "Not quite."}
            </p>
          )}

          {canCreate && !closed && (
            <button onClick={closeQuiz} className="mt-2 rounded bg-danger-strong px-3 py-1 text-xs text-white">
              Close & show results
            </button>
          )}

          {closed && closedResults?.[0]?.type === "SHORT_ANSWER" && (
            <p className="mt-2 text-xs text-ink-muted">
              Correct answer: <span className="text-ink-2">{closedResults[0].correctAnswerText}</span>
            </p>
          )}

          {closed && leaderboard && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium uppercase text-ink-muted">Leaderboard</p>
              {leaderboard.length === 0 && <p className="text-xs text-ink-muted">No answers submitted.</p>}
              {leaderboard.map((entry, i) => (
                <div key={entry.userId} className="flex justify-between text-xs text-ink-3">
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
