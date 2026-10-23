# free_tailor — Login/auth, AI call layer, cover letter generation (research)

Source: Explore research, 2026-10-22, over the read-only clone `F:/Develop/free_tailor`. Paths like `routes/auth.ts:45`
mean `backend/src/routes/auth.ts`; frontend paths are under `frontend/src/`. **Re-implement, never copy.**

**Main finding: free_tailor has no passwords.** Sign-in = Google Identity Services, or a six-digit code sent by email.
No create-account screen (the account is made the first time someone proves their address), no forgot/reset flow,
no magic link. free_tailor gates every page with `AuthGate`; TailorIT uses a `/login` route instead (same UI).

---

# PART 1 — Login and auth

## 1.1 Login page UX (`components/auth/SignInPanel.tsx`)

**Layout.** One centred column; no split screen, no background image.
- Page: `flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12`.
- Brand row: `mb-8 flex items-center gap-2.5`: icon 40×40 `rounded-lg` + wordmark (1.75rem, weight 800,
  letter-spacing -0.03em).
- Card: `w-full max-w-md p-6 sm:p-8`. H1 `text-2xl font-bold tracking-tight` **"Sign in"**; subtitle `mt-2 text-sm
  text-muted` "Tailor keeps your resumes to your own account." (TailorIT: "TailorIT keeps your resumes to your own account.")
- Below the card: `mt-6 text-center text-sm text-muted` **"Trouble signing in? "** + "Contact admin" link.
- (free_tailor's floating theme toggle — not in TailorIT.)

**States, in render order inside the card:**
1. Options loading (`GET /auth/options` pending): only heading + subtitle.
2. Options request failed: error notice: "We can't reach the server right now. Please try again in a moment, or contact
   your administrator if this continues."
3. Neither method configured: warn notice "Sign-in isn't available right now. Please contact your administrator."
4. Google available: `div.mt-6` with a centred container for Google's button + `p` "Loading Google sign-in..." until the
   script is ready. Script `https://accounts.google.com/gsi/client` (afterInteractive);
   `google.accounts.id.initialize({client_id, callback})` then
   `renderButton(el, {theme:'outline', size:'large', width:320, text:'signin_with'})`. No One Tap.
5. Both methods: divider `my-6 flex items-center gap-3`: two 1px lines around `text-xs uppercase tracking-wide` "or".
6. Email step 1: `form.mt-6.space-y-5`: Field "Email address" (`id=signin-email`), input `type=email required
   autoComplete=email placeholder="you@example.com"`; button full-width "Email me a code" ("Sending..." while busy),
   disabled when busy or empty.
7. Email step 2: Field "Six-digit code": `inputMode=numeric autoComplete=one-time-code pattern="\d{6}" maxLength=6
   autoFocus`, non-digits stripped while typing, styling `font-size:1.5rem; line-height:2rem; letter-spacing:0.5em;
   text-align:center`, placeholder "000000". Buttons (space-y-3): primary full-width "Sign in" ("Checking..."),
   disabled until 6 digits; quiet full-width "Use a different address" (back; clears code, error, notice). No Resend button.
8. After a code is sent: info notice with the server's message (only when no error).
9. Error notice. Fallback texts: "Could not send the code.", "That code did not work.", "That Google sign-in did not
   work." A failed verify clears the code field.
10. Disabled account (any 403 from `/google` or `/email/verify`): card replaced by H1 "This account is disabled", the
    server's sentence, buttons "Contact admin" and "Sign in with a different account"; "Trouble signing in?" hidden.

## 1.2 Flow and API contract
All under `/api/auth`, JSON. Errors `{ error, code? }`.
- **`GET /options`** → `{google:{available, clientId}, email:{available}}`.
- **`POST /google`** body `{credential}` → `{account, created}` + session cookie. 401s: "No Google credential was
  sent." / "That Google sign-in could not be verified. Please try again." / "Google returned a sign-in with no account
  details." / "That Google account has no email address." / "That Google account has not verified its email address,
  so it cannot be used to sign in." 403 disabled; 503 not configured.
- **`POST /email/request`** body `{email}` → `{sent:true, email, expiresInMinutes:10, message:"A six-digit code is on
  its way to ${email}. It expires in ${n} minutes."}`. 400 "That does not look like an email address." 429 "A code was
  just sent to that address. Wait N more second(s) before asking for another, and check the spam folder in the
  meantime." 503 "Sign-in isn't available right now. Please contact your administrator." 502 "We could not send the
  sign-in email right now. Please try again in a few minutes, or contact your administrator."
- **`POST /email/verify`** body `{email, code}` → `{account, created}` + cookie. 400 "A sign-in code is six digits."
  401 "That code has already been used, or none was sent to this address. Ask for a new one." / "That code has expired.
  Ask for a new one." / "That code was entered wrongly 5 times and is no longer valid. Ask for a new one." / "That code
  is not right. Check the email and try again." 403 "That account has been disabled. Ask an administrator of this
  installation to re-enable it."
- **`GET /me`** → always 200 `{account|null}`.
- **`POST /logout`** → destroys session if present, clears cookie, `{ok:true}`.
- `PATCH /account {name}` (1–120 chars): "There is nothing to change." / "A display name is between 1 and 120 characters."
- Guards: 401 `{error:"Sign in to do that.", code:"not-signed-in"}`; 403 admin-only: "That is an administrator-only part
  of this installation."

## 1.3 Session mechanism
- Token `crypto.randomBytes(32).toString('base64url')`; only its SHA-256 hex stored in `user_sessions.token_hash`.
- Cookie (free_tailor name `ft_session`; TailorIT `ti_session`): `httpOnly`, `sameSite:'lax'`, `secure` when https,
  `maxAge = SESSION_TTL_DAYS × 86,400,000`, `path:'/'`. `trust proxy` for the secure flag.
- free_tailor also stores a bearer copy in localStorage (`adminToken`) — **TailorIT: cookie only** (same-origin via
  Next rewrites).
- Per-request: unknown token → no user; expired → delete row; disabled account → no user; else update `last_seen`.
- Lifetime `SESSION_TTL_DAYS` default 30 (1–365), fixed (not sliding).
- CSRF: SameSite=Lax + JSON bodies + Origin check (TailorIT adds an explicit `Origin === APP_ORIGIN` check).

## 1.4 Codes, validation, email, Google
- Code: `crypto.randomInt(0, 1_000_000)` zero-padded to 6; stored SHA-256; 10-minute TTL; 5 attempts (5th wrong try
  deletes it); one live code per address; `timingSafeEqual`; deleted on success. **Email sent before the code is
  stored.**
- Email validation: trim + lowercase, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Same response whether or not an account exists.
- Rate limiting: 60-second resend cooldown per address (429) + 5-attempt cap. (TailorIT adds per-IP rate limits.)
- nodemailer pooled SMTP; `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` required; port 465 → TLS (`SMTP_SECURE` overrides);
  `SMTP_FROM` defaults to `SMTP_USER`; timeouts 10 s / 20 s. Subject `"${code} is your Tailor sign-in code"`; text:
  "Your Tailor sign-in code is ${code}. / It expires in ${ttl} minutes and can be used once. / If you did not ask to
  sign in, you can ignore this email - nobody can use the code without it." HTML shows the code at 28px bold,
  letter-spacing 6px.
- Google: `new OAuth2Client(clientId).verifyIdToken({idToken, audience: clientId})`, requires `email_verified`.
  Only `GOOGLE_CLIENT_ID` needed (no secret).

## 1.5 Tables and roles
- `users`: id (uuid), email (unique), name, picture, role (default 'user'), google_sub, disabled, created_at,
  updated_at, last_login_at (+ free_tailor-only columns to drop).
- `user_sessions(token_hash PK, user_id, created_at, expires_at, last_seen)`.
- `login_codes(email, code_hash, attempts, created_at, expires_at)`.
- Account creation on first proven sign-in; default name = email local part. Google sign-in refreshes name, picture,
  google_sub each time.
- Admin by configuration: `ADMIN_EMAILS` (comma/space list) promoted on create, at every sign-in and at startup; never
  demoted. Warn at startup when no admin is configured.

## 1.6 Account menu (free_tailor `AccountMenu.tsx`) — adapt to TailorIT
Trigger: avatar. Panel: header (name `text-sm font-semibold`, email `text-xs`), items (Settings; admin items), footer
"Log out" ("Signing out..." while running) in red (#b91c1c) with hover #fef2f2. Closes on outside click / Escape.
(TailorIT header uses Simplify's 40px initials square + caret; see screenshots-spec.md.)

## 1.7 Essential reference files
`frontend/src/components/auth/{SignInPanel,AuthGate,AccountMenu}.tsx`, `contexts/AuthContext.tsx`, `lib/auth.ts`,
`lib/userMessage.ts`; `backend/src/routes/auth.ts` (45-209), `middleware/auth.ts` (33-136, 188-201),
`services/auth/{authService,google,mailer}.ts`, `database/userRepository.ts` (55-96, 241-389, 567-746),
`database/sqlite.ts` (618-756), `config/adminIdentity.ts`, `index.ts` (89-167 CORS), `.env.example` (73-78, 106-169, 253-332).

---

# PART 2 — AI call surface

- Entry: `services/ai/index.ts` → `createPromptCompletion(input)` / `createPromptCompletionResult(input)`
  (`services/ai/promptExecution.ts:315-357`).
- Prompt files `backend/static/prompts/<id>.json` `{id, featureKey, content}`; variables `[[name]]`; everything before
  the first variable = system text, rest = user message (`promptAssembly.ts:105-155`).
- JSON mode: system text adds "You are a strict JSON generator. Return valid JSON only, with no markdown fences or
  extra text." (Gemini: `@@BEGIN_JSON@@ … @@END_JSON@@` sentinels). `extractJSON` (`utils/json.ts:195-227`) tries:
  sentinel text → ```json fence → whole reply → first balanced object/array; then repairs (curly quotes, comments,
  trailing commas, `...`), else throws "No valid JSON object found in model response".
- `maxTokens`/`temperature` are ignored by the CLI providers.
- Providers are CLI subscription seats: `claude-cli` (default), `codex-cli`, `gemini-cli`. Claude is run as:
  `claude -p --output-format stream-json --include-partial-messages --verbose --model <m> --effort <e> --tools ""
  --safe-mode --strict-mcp-config --disable-slash-commands --permission-prompts none --no-session-persistence
  --system-prompt <sys>` with the user message on stdin (`providers/claudeCli/argv.ts:120-197`). free_tailor defaults:
  `AI_CLI_MODEL=sonnet`, `AI_CLI_EFFORT=low`, fallback `haiku`, 4 concurrent, 300 s deadline.
- Server needs `npm i -g @anthropic-ai/claude-code` + `claude auth login` as the server user; `claude auth status`
  shows authMethod `claude.ai` or `oauth_token`.
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are removed from the child env (`claudeCli/env.ts:37-75`); if the CLI
  reports API-key billing anyway (`apiKeySource` ≠ none in `system/init`), the call is aborted
  (`claudeCli/index.ts:33-35, 268-299`).

---

# PART 3 — Cover letter generation

Prompt `backend/static/prompts/generate-cover-letter.json` (text output; variables `profileJson`, `companyName`, `role`;
**not given the job description** — TailorIT adds it). Rules (rewrite in TailorIT's own words, keep the intent):
- Body only, 3–4 paragraphs; no salutation, no sign-off, no bullet points; first person, first word "I".
- Never open a sentence with a resume-style action verb; vary sentence length.
- Open with enthusiasm for the work with the years/domain the profile states (none if it states none); one specific
  achievement from the profile as a brief story connecting to the role; a second moment showing personality and depth;
  what excites the candidate about this work/company; a confident non-templated close; no clichés ("I look forward to
  hearing from you").
- Where the profile gives little, the letter is shorter and plainer. Never round/re-base/invent figures, products,
  customers, team sizes, colleagues, technologies, skills or domains not in the profile.
- Banned words (any form): leveraged, utilized, spearheaded, orchestrated, streamlined, seamless, robust, scalable,
  maximized, cross-functional, end-to-end, innovative, dynamic, cutting-edge, world-class, state-of-the-art, holistic,
  comprehensive, proven, strategic. No sentences opening with Designed, Architected, Led, Delivered, Drove, Integrated,
  Partnered, Supported, Contributed, Managed or Streamlined. No metaphors. No em dashes, "--" or "–".
- Profile JSON sent: name, title, totalYearsExperience, summary, experience (title, company, dates, location,
  achievements, skills), strengths, skills, skillCategories, education, certifications. No contact details.
- Post-processing `dashBackstop`: em/en dashes and " -- " → ", ".

free_tailor formatting (`generators/coverLetterGenerator.ts`): random greeting ("Hello Hiring Team," …), paragraphs
`<p style="margin:0 0 12pt 0; line-height:1.5">`, "Best regards," + name; Arial 11pt #1A1A1A; PDF A4 0.75in margins;
DOCX via html-to-docx. (TailorIT follows Simplify's wrapper instead: centred name, contact line, "Dear Hiring Manager,",
paragraphs, "Sincerely,", name; US Letter.)
