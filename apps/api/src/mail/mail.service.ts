import { Inject, Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import type { Env } from "@arutech/config";

/**
 * The one place this app sends real email — real SMTP (nodemailer), not a
 * stub. `SMTP_*` env vars have existed in `packages/config/src/env.ts` (and
 * `nodemailer` as a declared dependency in `apps/api/package.json`) since
 * before this stage, unused anywhere — the same "real scaffolding waiting to
 * be wired up" pattern this codebase has had before (`FileAsset`,
 * `MeetingInvite`, `ChatRoom.photoUrl`). Local dev points this at MailHog
 * (`docker-compose.yml`'s `mailhog` service — SMTP on 1025, a real inbox
 * viewable at :8025) rather than a real mail provider, so this can be (and
 * was) live-verified by actually checking what arrived, not just that the
 * send call didn't throw.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(@Inject("ENV") env: Env) {
    this.from = env.SMTP_FROM;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }

  /** Fails loudly (throws) rather than silently swallowing a send failure —
   * callers that shouldn't block their own success on email delivery (e.g.
   * "the invite row was created either way") catch this explicitly at the
   * call site instead of this method pretending to succeed. */
  async send(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    } catch (err) {
      this.logger.error(`Failed to send email to ${opts.to}: ${String(err)}`);
      throw err;
    }
  }

  async sendOrganizationInvite(opts: {
    to: string;
    orgName: string;
    inviterName: string;
    acceptUrl: string;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `${opts.inviterName} invited you to join ${opts.orgName} on Arutech Meet`,
      text:
        `${opts.inviterName} invited you to join ${opts.orgName} on Arutech Meet.\n\n` +
        `Accept the invite: ${opts.acceptUrl}\n\n` +
        `If you weren't expecting this, you can ignore this email.`,
      html:
        `<p>${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.orgName)}</strong> on Arutech Meet.</p>` +
        `<p><a href="${opts.acceptUrl}">Accept the invite</a></p>` +
        `<p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>`,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
