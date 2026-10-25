# Skill library (data)

`skills.json` began as free_tailor v4.2's `backend/static/skills/skills.json`, used as data with the owner's approval,
and has been tidied since: **one main skill per family**, the rest of the family as its aliases, sorted, no duplicates.
TailorIT loads it in memory and overlays per-user skills (`user_skills`); nothing is written back to it.

## The rule

Two skills that would say the same thing twice on one resume are one skill. Listing `.NET`, `.NET Core`, `ASP.NET` and
`ASP.NET Core` side by side reads as padding, so `.NET` is the main skill and the other three are its aliases. A skill
becomes an alias of a main skill when it is:

- **another spelling or wording** of it: `Argo CD` of `ArgoCD`, `Microservices architecture` of `Microservices`;
- **a version or edition**: `HTTP/2` of `HTTP`, `Ubuntu` of `Linux`, `PL/SQL` of `SQL`;
- **a module, extension or standard companion** of a framework or tool: `Spring Security` of `Spring Boot`, `Redux` and
  `React Router` of `React`, `Docker Compose` of `Docker`, `kubectl` of `Kubernetes`;
- **an item of a list that the main skill sums up**: the design patterns of `Design Patterns`, load, stress and soak
  testing of `Performance Testing`, the "Cloud ..." phrasings of `Cloud Computing`.

Separate skills stay separate, even when they are often listed together: alternatives (`MySQL`, `PostgreSQL`; `Jest`,
`Mocha`), different tools (`Docker`, `Kubernetes`, `Helm`), a cloud's services (`AWS Lambda`, `Amazon S3`), languages
and their frameworks (`Python`, `Django`). An everyday English word never joins a family (`Kind`, `Triggers`,
`Promises`, `Paging`, `Ingress`, `Logs`): a resume that says "any kind of" would otherwise read as Kubernetes.

## What an alias does

- **Matching:** it is the same keyword as its main skill, so a posting that asks for `ASP.NET Core` is met by a resume
  that says `.NET`, and a posting that names both counts one keyword, not two.
- **The skill picker** (`GET /api/skills`) offers the main skills only, with each one's aliases for the search: typing
  "ASP.NET Core" suggests `.NET`. An alias typed in is still a known skill and is kept as typed.
- **Grouped skills:** an alias is filed under its main skill's heading.

## Layout

```json
{
  "hard": [{ "skill": ".NET", "priority": 5, "category": "Frameworks and Libraries", "aliases": [".NET Core", "ASP.NET"] }],
  "soft": ["Adaptability", "Big Picture Thinking"]
}
```

- **`hard`**: sorted by `category` (the order of the 17 headings in `HARD_SKILL_CATEGORIES`,
  `packages/shared/src/resume/catalogue.ts`), then `priority` (1 first), then `skill` (case ignored). `category` is the
  heading Grouped files the skill under; `priority` runs 1 to 5. `aliases` is optional and alphabetical.
- **`soft`**: alphabetical, case ignored. The soft scanner reads a hyphen and a space as one, so "Problem Solving" and
  "Problem-solving" are one entry.

## Editing it

1. Add a skill in its place (heading, priority, name), or as an alias of the main skill of its family.
2. Run `npm run skills:synonyms`: it writes the families into `packages/shared/src/match/library-synonyms.ts`, which is
   what makes an alias the same keyword as its main skill (the shared package imports no JSON).
3. Bump `RESUME_SKILLS_STAMP` (`packages/shared/src/resume/analysis.ts`) and add the new fingerprint to
   `SKILLS_FINGERPRINTS` in `apps/api/test/core.test.ts`: every resume is then read again.
4. The golden render manifest (`packages/render/test/golden/ft/manifest.json`, `inputs.skills`) records this file's
   hash: `npx vitest run --project render` (from the repository root) shows whether free_tailor's renders still match;
   update the hash once they do.

`apps/api/test/skills-library.test.ts` checks the layout, the order, that no skill is listed twice, that every alias is
found in postings and filed under its main skill's heading, and that step 2 was run. It says what to fix.
