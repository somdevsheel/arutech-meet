"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { PreJoin, type LocalUserChoices } from "@livekit/components-react";
import "@livekit/components-styles";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { MeetingRoom } from "@/components/meeting/meeting-room";
import { WS_EVENTS } from "@arutech/types";
import { getSocket } from "@/lib/socket";
import {
  setGuestSession,
  getStoredGuestParticipantId,
  storeGuestParticipantId,
} from "@/lib/guest-session";

interface MeetingPreview {
  code: string;
  title: string;
  status: string;
  requiresPassword: boolean;
  waitingRoomEnabled: boolean;
  branding: { orgName: string; logoUrl: string | null; brandColor: string | null; message: string | null } | null;
}

interface JoinResponse {
  participantId: string;
  role: string;
  status: "WAITING" | "ADMITTED";
  meeting: { id: string; code: string; title: string; livekitRoomName: string };
  livekitUrl: string | null;
  livekitToken: string | null;
  /** Set only for a guest join — see TokenService.GuestTokenPayload. Null for
   * an authenticated /join, which relies on the user's real access token
   * instead. */
  guestToken: string | null;
}

type Phase = "loading" | "lobby" | "joining" | "waiting" | "in-meeting" | "denied" | "error";

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

  // While in the waiting room, listen for the host's admit/deny decision.
  // A guest authenticates this same socket with their guestToken instead of
  // an access token (see TokenService.verifyAnyToken / RealtimeGateway) —
  // without that, a waiting guest had no way to ever be told they'd been
  // admitted or denied; only a fresh join attempt could ever move them out
  // of "Waiting for the host...". The deny listener itself existing at all
  // is a second, separate fix: nothing here ever caught WAITING_ROOM_DENY
  // before — a denied participant's screen just spun forever with no signal
  // anything had happened, since the server itself never reached them
  // either (see participants.service.ts's deny()).
  useEffect(() => {
    const authToken = accessToken ?? joinResult?.guestToken ?? null;
    if (phase !== "waiting" || !authToken || !joinResult) return;
    const socket = getSocket(authToken);
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
    const onDeny = (payload: { participantId: string }) => {
      if (payload.participantId !== joinResult.participantId) return;
      setPhase("denied");
    };
    socket.on(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
    socket.on(WS_EVENTS.WAITING_ROOM_DENY, onDeny);
    return () => {
      socket.off(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
      socket.off(WS_EVENTS.WAITING_ROOM_DENY, onDeny);
    };
  }, [phase, accessToken, joinResult]);

  async function handleJoin(choices: LocalUserChoices) {
    setPhase("joining");
    setError(null);
    try {
      const path = user ? `/meetings/${params.code}/join` : `/meetings/${params.code}/join-as-guest`;
      // A guest who already has a remembered participant id (a prior visit
      // this same tab — see lib/guest-session.ts) sends it back so the
      // server can recognize them as the SAME guest, rather than always
      // starting a fresh WAITING row that could never carry over a DENIED
      // or REMOVED status from before.
      const guestParticipantId = user ? undefined : (getStoredGuestParticipantId(params.code) ?? undefined);
      const result = await apiFetch<JoinResponse>(path, {
        method: "POST",
        body: JSON.stringify({
          password: password || undefined,
          guestName: user ? undefined : choices.username,
          guestParticipantId,
        }),
        skipAuth: !user,
      });
      if (!user && result.guestToken) {
        setGuestSession(result.guestToken, result.meeting.id);
        storeGuestParticipantId(params.code, result.participantId);
      }
      setJoinResult(result);
      setPhase(result.status === "ADMITTED" ? "in-meeting" : "waiting");
    } catch (err) {
      // A denied/removed guest re-joining hits this same ForbiddenException
      // the waiting-room deny listener otherwise reports live — see
      // MeetingsService.join's DENIED/REMOVED guard. Route it to the same
      // full "denied" screen instead of just an inline lobby error, since
      // it's the exact same outcome, just discovered on this join attempt
      // itself rather than while already waiting.
      const message = err instanceof ApiError ? err.message : "Failed to join meeting";
      if (err instanceof ApiError && err.status === 403 && /denied entry|removed from this meeting/.test(message)) {
        setPhase("denied");
        return;
      }
      setError(message);
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
        authToken={accessToken ?? joinResult.guestToken}
        onLeave={() => router.push(user ? "/dashboard" : "/")}
      />
    );
  }

  if (phase === "waiting") {
    return <CenteredMessage text="Waiting for the host to let you in…" spinner />;
  }

  if (phase === "denied") {
    return <CenteredMessage text="The host didn't let you into this meeting." isError />;
  }

  const branding = preview?.branding ?? null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      {branding?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary org-supplied URL, not a static asset
        <img src={branding.logoUrl} alt={`${branding.orgName} logo`} className="h-12 max-w-[220px] object-contain" />
      )}
      <h1 className="text-xl font-semibold text-white">{preview?.title}</h1>
      {branding?.message && <p className="max-w-md text-center text-sm text-ink-muted">{branding.message}</p>}
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
        // Real per-org theming: override the exact `--lk-*` custom properties
        // globals.css already retheme's LiveKit's prefabs with (see that
        // file's comment) — the org's brandColor becomes the PreJoin "Join
        // meeting" button's actual rendered color, not just a stored hex
        // nobody reads. Scoped to this one wrapper via inline style, so an
        // unbranded meeting is untouched.
        style={
          branding?.brandColor
            ? ({ "--lk-accent-bg": branding.brandColor, "--lk-control-active-bg": branding.brandColor } as CSSProperties)
            : undefined
        }
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
