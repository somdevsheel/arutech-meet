"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PreJoin, type LocalUserChoices } from "@livekit/components-react";
import "@livekit/components-styles";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { MeetingRoom } from "@/components/meeting/meeting-room";
import { WS_EVENTS } from "@arutech/types";
import { getSocket } from "@/lib/socket";

interface MeetingPreview {
  code: string;
  title: string;
  status: string;
  requiresPassword: boolean;
  waitingRoomEnabled: boolean;
}

interface JoinResponse {
  participantId: string;
  role: string;
  status: "WAITING" | "ADMITTED";
  meeting: { id: string; code: string; title: string; livekitRoomName: string };
  livekitUrl: string | null;
  livekitToken: string | null;
}

type Phase = "loading" | "lobby" | "joining" | "waiting" | "in-meeting" | "error";

export default function MeetingPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { user, accessToken } = useAuthStore();

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<MeetingPreview | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joinResult, setJoinResult] = useState<JoinResponse | null>(null);

  useEffect(() => {
    apiFetch<MeetingPreview>(`/meetings/${params.code}`, { skipAuth: !accessToken })
      .then((p) => {
        setPreview(p);
        setPhase("lobby");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Meeting not found");
        setPhase("error");
      });
  }, [params.code, accessToken]);

  // While in the waiting room, listen for the host's admit decision (authenticated
  // users only — guests without an access token cannot open the authenticated
  // WebSocket channel in this MVP and must be re-admitted via a fresh join attempt).
  useEffect(() => {
    if (phase !== "waiting" || !accessToken || !joinResult) return;
    const socket = getSocket(accessToken);
    socket.emit(WS_EVENTS.JOIN_MEETING, { meetingId: joinResult.meeting.id });

    const onAdmit = async (payload: { participantId: string }) => {
      if (payload.participantId !== joinResult.participantId) return;
      try {
        const { token, url } = await apiFetch<{ token: string; url: string }>(
          `/meetings/${joinResult.meeting.id}/participants/${joinResult.participantId}/token`,
          { method: "POST" },
        );
        setJoinResult({ ...joinResult, livekitToken: token, livekitUrl: url, status: "ADMITTED" });
        setPhase("in-meeting");
      } catch {
        // stay in waiting state; host may retry admit
      }
    };
    socket.on(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
    return () => {
      socket.off(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
    };
  }, [phase, accessToken, joinResult]);

  async function handleJoin(choices: LocalUserChoices) {
    setPhase("joining");
    setError(null);
    try {
      const path = user ? `/meetings/${params.code}/join` : `/meetings/${params.code}/join-as-guest`;
      const result = await apiFetch<JoinResponse>(path, {
        method: "POST",
        body: JSON.stringify({
          password: password || undefined,
          guestName: user ? undefined : choices.username,
        }),
        skipAuth: !user,
      });
      setJoinResult(result);
      setPhase(result.status === "ADMITTED" ? "in-meeting" : "waiting");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to join meeting");
      setPhase("lobby");
    }
  }

  if (phase === "loading") return <CenteredMessage text="Loading meeting…" />;
  if (phase === "error") return <CenteredMessage text={error ?? "Something went wrong"} isError />;

  if (phase === "in-meeting" && joinResult?.livekitToken && joinResult.livekitUrl) {
    return (
      <MeetingRoom
        meetingId={joinResult.meeting.id}
        meetingCode={joinResult.meeting.code}
        title={joinResult.meeting.title}
        token={joinResult.livekitToken}
        livekitUrl={joinResult.livekitUrl}
        participantId={joinResult.participantId}
        role={joinResult.role}
        userId={user?.id ?? null}
        accessToken={accessToken}
        onLeave={() => router.push(user ? "/dashboard" : "/")}
      />
    );
  }

  if (phase === "waiting") {
    return <CenteredMessage text="Waiting for the host to let you in…" spinner />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold text-white">{preview?.title}</h1>
      {preview?.requiresPassword && (
        <input
          type="password"
          placeholder="Meeting password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input max-w-sm"
        />
      )}
      <div
        data-lk-theme="default"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-surface-border"
      >
        <PreJoin
          defaults={{ username: user?.displayName ?? "" }}
          onSubmit={handleJoin}
          joinLabel={phase === "joining" ? "Joining…" : "Join meeting"}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function CenteredMessage({
  text,
  isError,
  spinner,
}: {
  text: string;
  isError?: boolean;
  spinner?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      {spinner && (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      )}
      <p className={isError ? "text-red-400" : "text-slate-300"}>{text}</p>
    </div>
  );
}
