import { loginSchema, registerSchema, requestPasswordResetSchema } from "@arutech/validation";

// Regression coverage for the case-sensitivity bug: User.email is a plain
// case-sensitive unique index, and these schemas never normalized email at
// all — "Bob@Acme.com" at signup and "bob@acme.com" at login were two
// different values as far as any DB lookup was concerned. See git history
// for the finding.
describe("email normalization across auth schemas", () => {
  it("trims and lowercases a registration email", () => {
    const result = registerSchema.safeParse({
      email: "  Bob@Acme.com  ",
      password: "Password123",
      displayName: "Bob",
      username: "bob123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("bob@acme.com");
  });

  it("trims and lowercases a login email", () => {
    const result = loginSchema.safeParse({ email: "  Bob@Acme.com  ", password: "whatever" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("bob@acme.com");
  });

  it("trims and lowercases a password-reset request email", () => {
    const result = requestPasswordResetSchema.safeParse({ email: "Bob@Acme.com" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("bob@acme.com");
  });

  it("still rejects a genuinely invalid email after normalization", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "Password123",
      displayName: "Bob",
      username: "bob123",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes two differently-cased inputs to the identical value", () => {
    const a = loginSchema.safeParse({ email: "Bob@Acme.com", password: "x" });
    const b = loginSchema.safeParse({ email: "bob@acme.com", password: "x" });
    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) expect(a.data.email).toBe(b.data.email);
  });
});
