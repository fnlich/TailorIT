import { APP_NAME } from '@tailorit/shared';
import type { MailMessage } from './mailer';

/** The sign-in code email: the code in the subject (readable from a notification), plain text plus simple HTML. */
export function signInCodeEmail(to: string, code: string, ttlMinutes: number): MailMessage {
  const expiry = `It expires in ${ttlMinutes} minutes and can be used once.`;
  const ignore = 'If you did not ask to sign in, you can ignore this email - nobody can use the code without it.';
  return {
    to,
    subject: `${code} is your ${APP_NAME} sign-in code`,
    text: [`Your ${APP_NAME} sign-in code is ${code}.`, expiry, ignore].join('\n\n'),
    html: [
      `<p>Your <strong>${APP_NAME}</strong> sign-in code is:</p>`,
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>`,
      `<p>${expiry}</p>`,
      `<p style="color:#666666;font-size:13px">${ignore}</p>`,
    ].join('\n'),
  };
}
