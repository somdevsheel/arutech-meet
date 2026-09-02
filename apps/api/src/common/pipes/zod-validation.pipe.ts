import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { formatZodIssues } from "../lib/format-zod-issues";

/**
 * Validates+transforms a request body/query against a Zod schema from
 * @arutech/validation. Usage: `@Body(new ZodValidationPipe(createMeetingSchema)) dto: CreateMeetingDto`.
 * The same schema is importable by apps/web for client-side validation, so the
 * rules are defined once and enforced authoritatively here.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // M-3: this used to join the raw field path in verbatim (e.g.
      // "avatarUrl: Invalid url") — internal camelCase names a client never
      // chose, going straight into a form's error banner. See
      // format-zod-issues.ts for why this is fixed at the source rather
      // than in each page that happens to display it.
      throw new BadRequestException({ message: formatZodIssues(result.error.issues) });
    }
    return result.data;
  }
}
