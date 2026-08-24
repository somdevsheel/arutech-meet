import { ServiceUnavailableException } from "@nestjs/common";
import type { CalendarConnectResult, CalendarProvider, CalendarProviderName } from "./calendar-provider.interface";

/**
 * The only `CalendarProvider` implementation today — see that interface's
 * doc comment. Fails loudly and explicitly rather than returning a fake
 * "connected" state, per this project's "no fake implementations" rule
 * (`docs/roadmap.md`): `CalendarController` surfaces this as a normal 503 to
 * the caller, not a silently-inert button.
 */
export class NullCalendarProvider implements CalendarProvider {
  readonly name = "none";

  async connect(_userId: string, provider: CalendarProviderName): Promise<CalendarConnectResult> {
    const label = provider === "google" ? "Google Calendar" : "Outlook Calendar";
    throw new ServiceUnavailableException(
      `${label} sync is not configured on this server yet — this endpoint is real, not a placeholder that ` +
        "fakes success; it's just not backed by a live OAuth integration in this build. See CalendarProvider " +
        "for the seam a real implementation would plug into.",
    );
  }
}
