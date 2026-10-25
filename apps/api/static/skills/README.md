# Skill library (data)

`skills.json` began as free_tailor v4.2's `backend/static/skills/skills.json`, used as data with the owner's approval,
and has been tidied since: one entry per skill, sorted, no duplicates. TailorIT loads it in memory and overlays
per-user skills (`user_skills`); nothing is written back to it.

## Layout

```json
{
  "hard": [{ "skill": "Apache Kafka", "priority": 5, "category": "Data Engineering & Streaming", "aliases": ["Kafka"] }],
  "soft": ["Adaptability", "Big Picture Thinking"]
}
```

- **`hard`**: one entry per skill, sorted by `category` (the order of the 17 headings in `HARD_SKILL_CATEGORIES`,
  `packages/shared/src/resume/catalogue.ts`), then `priority` (1 first), then `skill` (case ignored). `category` is the
  heading Grouped files the skill under. `priority` runs 1 to 5.
- **`aliases`** (optional): other spellings of the same skill: `Kafka`, `GCP`, `HTML5`, `Argo CD`. An alias is the same
  keyword as its entry, and sits under its entry's heading and priority. The skill picker still offers it, since people
  write it that way.
- **`soft`**: soft skills, alphabetical, case ignored. The soft scanner reads a hyphen and a space as one, so
  "Problem Solving" and "Problem-solving" are one entry.

## Editing it

- Add a skill in its place: heading, then priority, then name. If it is another spelling of a skill that is there,
  make it an alias instead of an entry.
- **List an alias with its entry in `TERM_SYNONYMS`** (`packages/shared/src/match/terms.ts`) as well: that table is what
  makes the two one keyword for the matcher.
- **Make something an alias only if it is the same skill.** A generic name and one vendor's product of that kind stay
  two entries ("SQL" and "Azure SQL", "DevOps" and "Azure DevOps", "Secrets Manager" and "AWS Secrets Manager"). Folding
  a short name that is an everyday word or names other vendors' products too ("Beam", "Express", "Lambda", "IAM")
  works, but a resume that writes only the short name is then read as having the long one, so a posting that asks for
  the long one can be matched too loosely.
- `apps/api/test/skills-library.test.ts` checks all of this: the layout, the order, no skill listed twice, and aliases
  that are found and filed under their entry's heading. It says what to fix.
- Any change to the lists must bump `RESUME_SKILLS_STAMP` (`packages/shared/src/resume/analysis.ts`) and add the new
  fingerprint to `SKILLS_FINGERPRINTS` in `apps/api/test/core.test.ts`: every resume is then read again. The golden
  render manifest (`packages/render/test/golden/ft/manifest.json`, `inputs.skills`) records this file's hash too; after
  a change, `npx vitest run --project render` (from the repository root) shows whether free_tailor's renders still
  match before you update it.
