/**
 * External calendar sync (Google/Outlook) — architecture-and-stub only in
 * this pass, per `docs/advanced-features-roadmap.md` Priority 3 item 5's own
 * scoping: "a `CalendarProvider` interface, mirroring how Stage 8 avoided
 * hardcoding one AI vendor, rather than a full two-way sync in the first
 * pass." Mirrors `SummarizationProvider`'s shape exactly
 * (`apps/api/src/ai/providers/summarization-provider.interface.ts`): one
 * interface, selected by provider name, with a `Null*` implementation that
 * fails loudly rather than faking success — see `NullCalendarProvider`.
 *
 * There is deliberately no real Google/Outlook implementation yet (no OAuth
 * flow, no token storage model, no push/pull sync job) — that's genuinely
 * new work the roadmap item itself calls out as out of scope for this stage.
 * A real implementation would live alongside `NullCalendarProvider` in this
 * directory and get selected by `../calendar.module.ts`'s provider factory,
 * the same way `OpenAiSummarizationProvider` is selected there.
 */
export type CalendarProviderName = "google" | "outlook";

export interface CalendarConnectResult {
  /** Where the client should send the user to complete OAuth. Never reached
   * today — `NullCalendarProvider.connect` always throws first. */
  authUrl: string;
}

export interface CalendarProvider {
  readonly name: string;
  connect(userId: string, provider: CalendarProviderName): Promise<CalendarConnectResult>;
}

export const CALENDAR_PROVIDER = Symbol("CALENDAR_PROVIDER");
