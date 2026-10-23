// Next's ambient types for `npm run typecheck`, which deliberately does not read next-env.d.ts: Next rewrites that
// file to import generated route types under .next/dev/types, which are stale or missing on a clean checkout.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
