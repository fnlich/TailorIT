import { OAuth2Client } from 'google-auth-library';

// Google sign-in. The browser runs Google Identity Services itself and hands the API one ID token. That token is the
// only thing trusted, and only after its signature, expiry and audience are checked against Google's published keys:
// an unverified JWT is a string the caller chose. The audience check matters as much as the signature, because a
// token Google issued for some other site is valid and says nothing about signing in here.

/** The fields of a verified ID token that sign-in reads. */
export interface GoogleTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/** Verifies an ID token for `clientId` and returns its payload; throws when Google's checks fail. */
export type GoogleTokenVerifier = (idToken: string, clientId: string) => Promise<GoogleTokenPayload | undefined>;

/** The real verifier: google-auth-library's OAuth2Client (which caches Google's certificates), one per client id. */
export function createGoogleTokenVerifier(): GoogleTokenVerifier {
  const clients = new Map<string, OAuth2Client>();
  return async (idToken, clientId) => {
    let client = clients.get(clientId);
    if (!client) {
      client = new OAuth2Client(clientId);
      clients.set(clientId, client);
    }
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return ticket.getPayload();
  };
}
