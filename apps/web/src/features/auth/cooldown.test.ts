import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { codeAlreadySentNotice, cooldownSeconds } from './cooldown';

const cooldown = (retryAfterSeconds?: number) =>
  new ApiError({ status: 429, code: 'cooldown', message: 'A code was just sent to that address.', retryAfterSeconds });

describe('sign-in code cooldown', () => {
  it('reads the seconds left from a 429 cooldown', () => {
    expect(cooldownSeconds(cooldown(45))).toBe(45);
    expect(cooldownSeconds(cooldown(0.2))).toBe(1);
    expect(cooldownSeconds(cooldown())).toBe(60);
  });

  it('leaves every other failure an error, too many attempts included', () => {
    expect(cooldownSeconds(new ApiError({ status: 429, code: 'rate_limited', message: 'Too many.', retryAfterSeconds: 600 }))).toBeNull();
    expect(cooldownSeconds(new ApiError({ status: 400, code: 'validation_failed', message: 'Not an email.' }))).toBeNull();
    expect(cooldownSeconds(new Error('offline'))).toBeNull();
  });

  it('says where the code went and how long until another', () => {
    expect(codeAlreadySentNotice('ann@example.com', 45)).toBe(
      'A code was already sent to ann@example.com. Enter it below, or wait 45 seconds to ask for another.',
    );
    expect(codeAlreadySentNotice('ann@example.com', 1)).toContain('wait 1 second to ask');
  });
});
