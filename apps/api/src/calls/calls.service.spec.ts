import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { CallsService } from "./calls.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { ContactsService } from "../contacts/contacts.service";

// initiate() schedules a real 45s ring-timeout (see CallsService); fake timers
// keep that from leaving a dangling handle open after each test finishes.
beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

const CALLER = { id: "caller-1", displayName: "Caller", avatarUrl: null };
const CALLEE = { id: "callee-1", displayName: "Callee", avatarUrl: null };

function makeDeps(overrides?: {
  busyParticipant?: unknown;
  call?: Partial<{ status: string; initiatorId: string }>;
  participant?: Partial<{ status: string }> | null;
  isBlocked?: boolean;
}) {
  const call = { id: "call-1", status: "RINGING", initiatorId: CALLER.id, livekitRoomName: "call-abc", ...overrides?.call };
  const participant =
    overrides?.participant === null
      ? null
      : { id: "participant-1", callId: "call-1", userId: CALLEE.id, status: "RINGING", ...overrides?.participant };

  const prisma = {
    client: {
      user: {
        findMany: jest.fn().mockResolvedValue([CALLEE]),
        findUniqueOrThrow: jest.fn().mockResolvedValue(CALLER),
      },
      callParticipant: {
        findFirst: jest.fn().mockResolvedValue(overrides?.busyParticipant ?? null),
        findUnique: jest.fn().mockResolvedValue(participant),
        findMany: jest.fn().mockResolvedValue([{ userId: CALLER.id }, { userId: CALLEE.id }]),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      call: {
        create: jest.fn().mockResolvedValue(call),
        findUnique: jest.fn().mockResolvedValue(call),
        findUniqueOrThrow: jest.fn().mockResolvedValue(call),
        update: jest.fn(),
      },
    },
  } as unknown as PrismaService;

  const liveKit = {
    ensureRoom: jest.fn(),
    createRoomToken: jest.fn().mockResolvedValue("token-abc"),
    getClientUrl: jest.fn().mockReturnValue("wss://livekit.example"),
  } as unknown as LiveKitService;

  const broadcast = { publishToRoom: jest.fn() } as unknown as RealtimeBroadcastService;
  const notifications = { create: jest.fn() } as unknown as NotificationsService;
  const contacts = { isBlocked: jest.fn().mockResolvedValue(overrides?.isBlocked ?? false) } as unknown as ContactsService;

  return { prisma, liveKit, broadcast, notifications, contacts };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new CallsService(deps.prisma, deps.liveKit, deps.broadcast, deps.notifications, deps.contacts);
}

describe("CallsService.initiate", () => {
  it("rejects calling yourself", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.initiate(CALLER.id, { calleeUserIds: [CALLER.id], type: "VIDEO" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects calling someone with a block relationship in either direction", async () => {
    const deps = makeDeps({ isBlocked: true });
    const service = makeService(deps);
    await expect(
      service.initiate(CALLER.id, { calleeUserIds: [CALLEE.id], type: "VIDEO" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.prisma.client.call.create).not.toHaveBeenCalled();
  });

  it("rejects when the sole callee is already on another call", async () => {
    const deps = makeDeps({ busyParticipant: { id: "x" } });
    const service = makeService(deps);
    await expect(
      service.initiate(CALLER.id, { calleeUserIds: [CALLEE.id], type: "VIDEO" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deps.prisma.client.call.create).not.toHaveBeenCalled();
  });

  it("creates a RINGING call, mints a token for the caller, and notifies the callee live", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.initiate(CALLER.id, { calleeUserIds: [CALLEE.id], type: "VIDEO" });

    expect(deps.prisma.client.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RINGING", initiatorId: CALLER.id }),
      }),
    );
    expect(result).toMatchObject({ callId: "call-1", token: "token-abc" });
    expect(result.livekitRoomName).toMatch(/^call-/);
    expect(deps.broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${CALLEE.id}`,
      expect.stringContaining("call"),
      expect.objectContaining({ callId: "call-1" }),
    );
    expect(deps.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CALLEE.id, type: "CALL_INCOMING" }),
    );
  });
});

describe("CallsService.accept", () => {
  it("404s if the caller isn't actually a participant of this call", async () => {
    const deps = makeDeps({ participant: null });
    const service = makeService(deps);
    await expect(service.accept(CALLEE.id, "call-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects accepting a call that isn't ringing anymore", async () => {
    const deps = makeDeps({ participant: { status: "DECLINED" } });
    const service = makeService(deps);
    await expect(service.accept(CALLEE.id, "call-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("flips the call to ONGOING and mints a token for the callee", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.accept(CALLEE.id, "call-1");

    expect(deps.prisma.client.call.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ONGOING" }) }),
    );
    expect(result.token).toBe("token-abc");
    expect(deps.broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${CALLER.id}`,
      expect.stringContaining("accepted"),
      expect.objectContaining({ callId: "call-1", byUserId: CALLEE.id }),
    );
  });
});

describe("CallsService.cancel", () => {
  it("only lets the initiator cancel", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.cancel(CALLEE.id, "call-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses to cancel a call that's already been answered", async () => {
    const deps = makeDeps({ call: { status: "ONGOING" } });
    const service = makeService(deps);
    await expect(service.cancel(CALLER.id, "call-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("cancels a still-ringing call and notifies the callee", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.cancel(CALLER.id, "call-1");

    expect(deps.prisma.client.call.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }),
    );
    expect(deps.broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${CALLEE.id}`,
      expect.stringContaining("call"),
      expect.objectContaining({ reason: "canceled" }),
    );
  });
});
