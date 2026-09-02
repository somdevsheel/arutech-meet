import { z } from "zod";
import { formatZodIssues } from "./format-zod-issues";

function issuesOf(schema: z.ZodTypeAny, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected parsing to fail");
  return result.error.issues;
}

describe("formatZodIssues", () => {
  it("turns a camelCase field name into a spaced, capitalized label", () => {
    const issues = issuesOf(z.object({ displayName: z.string().min(1) }), { displayName: "" });
    expect(formatZodIssues(issues)).toEqual([expect.stringMatching(/^Display Name: /)]);
  });

  it("uppercases a trailing Url/Id segment (Avatar URL, User ID)", () => {
    const issues = issuesOf(z.object({ avatarUrl: z.string().url() }), { avatarUrl: "not-a-url" });
    expect(formatZodIssues(issues)[0]).toMatch(/^Avatar URL: /);

    const idIssues = issuesOf(z.object({ userId: z.string().uuid() }), { userId: "nope" });
    expect(formatZodIssues(idIssues)[0]).toMatch(/^User ID: /);
  });

  it("labels a nested field by its own name, not the full dotted path", () => {
    const schema = z.object({ settings: z.object({ waitingRoomEnabled: z.boolean() }) });
    const issues = issuesOf(schema, { settings: { waitingRoomEnabled: "yes" } });
    expect(formatZodIssues(issues)[0]).toMatch(/^Waiting Room Enabled: /);
  });

  it("leaves a path-less root-level issue (e.g. a cross-field .refine()) unprefixed", () => {
    const schema = z
      .object({ password: z.string(), confirm: z.string() })
      .refine((v) => v.password === v.confirm, { message: "Passwords don't match" });
    const issues = issuesOf(schema, { password: "a", confirm: "b" });
    expect(formatZodIssues(issues)).toEqual(["Passwords don't match"]);
  });

  it("preserves each schema's own custom validation message, only reformatting the label", () => {
    const issues = issuesOf(
      z.object({ currentPassword: z.string().min(8, "Password must be at least 8 characters") }),
      { currentPassword: "short" },
    );
    expect(formatZodIssues(issues)).toEqual(["Current Password: Password must be at least 8 characters"]);
  });
});
