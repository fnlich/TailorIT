import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/env';

// Outgoing mail (sign-in codes). Real SMTP only: there is no "pretend it was sent" mode, because a code that silently
// never arrives is worse than a clear refusal. Development without SMTP prints codes instead (features/auth).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Closes pooled connections (shutdown, one-shot scripts). */
  close(): void;
}

export type SmtpSettings = NonNullable<AppConfig['auth']['smtp']>;

/** A message the SMTP server did not take. The text names the server and its reason, never the message body. */
export class MailSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MailSendError';
  }
}

/**
 * A pooled SMTP mailer. The connection is opened on the first send, not at startup. Timeouts are bounded on purpose:
 * a network that blocks outbound SMTP drops packets instead of refusing, and without them a sign-in would hang.
 */
export function createSmtpMailer(smtp: SmtpSettings): Mailer {
  let transport: Transporter | null = null;
  const connect = () =>
    (transport ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    }));

  return {
    async send(message) {
      try {
        await connect().sendMail({ from: smtp.from, ...message });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new MailSendError(`Could not send mail via ${smtp.host}:${smtp.port}: ${reason}`, { cause: error });
      }
    },
    close() {
      transport?.close();
      transport = null;
    },
  };
}
