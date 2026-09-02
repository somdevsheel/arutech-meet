import { BadRequestException, ForbiddenException, type ArgumentsHost } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { z } from "zod";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { id: "req-1", url: "/api/v1/whatever" };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("AllExceptionsFilter", () => {
  // H-10: ThrottlerException's own default message is the literal string
  // "ThrottlerException: Too Many Requests" — this must never reach the
  // client verbatim.
  it("replaces ThrottlerException's raw message with a friendly one", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new ThrottlerException(), host);

    expect(status).toHaveBeenCalledWith(429);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBe("Too many attempts. Please wait a minute and try again.");
    expect(body.error.message).not.toMatch(/ThrottlerException/);
  });

  it("still passes through a real HttpException's own message unchanged", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new ForbiddenException("Not allowed"), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0].error.message).toBe("Not allowed");
  });

  it("still passes through BadRequestException's message unchanged (not confused with ThrottlerException)", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new BadRequestException("Bad input"), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toBe("Bad input");
  });

  it("still formats a ZodError into per-field validation messages", () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = makeHost();
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "not-an-email" });

    filter.catch(result.error, host);

    expect(json.mock.calls[0][0].error.code).toBe("VALIDATION_ERROR");
    expect(json.mock.calls[0][0].error.message[0]).toContain("email");
  });
});
