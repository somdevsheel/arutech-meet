import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PresenceService } from "./presence.service";

const MAX_LOOKUP = 100;

@ApiTags("presence")
@Controller("presence")
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /** Bulk lookup for whatever set of users the client currently cares about
   * — a contacts list, an open chat room's member list. Authenticated but
   * not otherwise permission-checked: presence status alone is no more
   * sensitive than `User.lastSeenAt`, which is already exposed the same way
   * (Contacts, chat room member lists). */
  @Get()
  async getMany(@Query("userIds") userIds?: string) {
    const ids = [...new Set((userIds ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LOOKUP);
    return this.presence.getStatuses(ids);
  }
}
