import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

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
      throw new BadRequestException({
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return result.data;
  }
}
