# Jobs — Simplify's Jobs page + job analysis, and free_tailor's jobs data (research)

Source: Explore research, 2026-10-22, over free_tailor (read-only clone `F:/Develop/free_tailor`) and Simplify's served
Next.js chunks (session scratchpad, now gone). The user's screenshot `e2e/reference/simplify-1.png` + `screenshots-spec.md`
override anything here. TailorIT must never use Simplify's search index/keys or APIs.

---

# PART A — free_tailor

## A1. The Job Data Lake

**Table `job_lake`** (`backend/src/database/sqlite.ts:850-880`): `id` (INTEGER autoinc), `job_hash`, `hash_version`,
`company`, `company_key`, `job_field_id`, `title`, `salary_min`/`salary_max` (REAL), `salary_currency`,
`salary_period` (`annual|monthly|weekly|daily|hourly`), `salary_raw` (≤200 chars), `job_url`, `job_description`,
`analysis_id`, `requested_by`, `source` (`'report'|'merge'`), `created_at`, `updated_at`, `seen_count`,
`last_seen_at`, `sheet_synced_at`, reward columns, `job_type` (`'remote'|'hybrid'|'on_site'|''`), `clearance` (0/1),
`industry`.

Related: `job_lake_history` (older versions), `job_reports`, `job_lake_fts` (FTS5 over company/title/description).

User-visible fields (`services/jobLake/findJobs.ts:28-77`): `id, company, title, url, jobFieldId, jobFieldLabel,
salary {min,max,currency,period,raw}, jobType, jobTypeLabel ("Remote"/"Hybrid"/"Onsite"), clearance, industry,
industryLabel, updatedAt, analysisId` (+ `jobDescription` in detail).

Fixed lists: industries 18 + "Other" + "Not specified" (`config/industries.ts:37-55,182`); job fields 103 in 10 areas
(`config/jobFields.ts:42-51`) + `unclassified`.

**Not in the lake:** location, original posted date (`created_at`/`updated_at` are lake times), employment type,
experience level (only inside the analysis), category hierarchy, company logo/tagline/size, separate apply URL,
whether the posting is still live. **Granularity: one row per company + job field** (dedupe hash =
`sha256("v1\0companyKey\0jobFieldId")`), so several postings of one company in one field collapse into one row.

**Where lake jobs come from:** (1) reporter runs from Google Sheets (columns A–F: Date, NO(DATE), Company, Job Title,
Job Link, Job Description), each analysed then merged; (2) admin merge of build analyses; (3) no scraping (Apify search
removed in v4.2).

**Posting identity helpers** (`services/jobAnalysis/identity.ts:21-118`): `linkKey` (https/http folded, host lowercased,
default port/fragment dropped, `utm_*`/`gclid`/`fbclid`/`ref` removed, params sorted, trailing slash removed);
`contentHash` = SHA-256 of whitespace-normalised text. Company normalisation (`services/jobLake/identity.ts:107-155`):
symbols dropped, NFKC, lowercase, punctuation removed, legal suffixes stripped, spaces removed.

**Search** (`services/jobLake/filters.ts:158-218`, `jobLakeRepository.ts:710-945`): FTS `q` (≤10 keywords, prefix for
3+ chars), company, field, jobType, industry, salary range overlap, updated range, clearance; newest-first; limit/offset.

## A2. Job analysis (free_tailor)

Prompt `backend/static/prompts/analyze-job-description.json` — "professional resume keyword extractor … EXTRACT WHAT THE
POSTING SAYS, IN THE POSTING'S WORDS". 8 exclusions (company/brand names, locations, internal teams, legal/EEO/visa,
pay/benefits, recruiting copy, slogans, the advertised title). Abbreviations get both forms ("LLMs" and "Large Language
Models"). Output:
```
{"jobMeta":{"title":"","seniority":"","industry":"","department":""},
 "skills":{"technical":[],"tools":[],"soft":[]},
 "technologies":[],"protocols":[],"methodologies":[],"architecturePatterns":[],
 "responsibilities":[],"domainKnowledge":[],
 "keywords":{"actionVerbs":[],"buzzwords":[],"mustInclude":[]}}
```
`seniority` ∈ `junior|mid|senior|lead|principal|staff|manager|unknown`; `mustInclude` = ATS-critical terms.
A second prompt `filter-google-sheet-job.json` returns job_type, onsite_interview, company_category, seniority (years
rule 0–2 junior, 3–5 mid, 5+ senior), clearance_required, salary, region, us_state, plus job_field.
Runs once per posting (gate by sheet cell → link key → content hash → in-flight), stored insert-if-absent in
`job_analyses` (unique `content_hash`, `link_key`). **Gaps vs Simplify:** no display bullet lists, no required/preferred split.

## A3. Keyword matching (free_tailor reference for TailorIT's matcher)

`backend/src/services/resumeKeywords.ts` (pure): resume terms from (1) curated `resume.skills` + `experience[].skills`
spelled per the vocabulary; (2) `scanText(resume)` over title, summary, skills, strengths, role titles/descriptions/
bullets/skills, certifications, projects, volunteering, courses, awards, publications — searched for the vocabulary:
`skills.json` hard list (1,492), concept table aliases (`config/conceptTools.ts:36-245`), 24 synonym groups
`TERM_SYNONYMS` (`:130-155`). Case rules (`classify :192-202`): 1-char terms never matched in prose; 2-letter terms need
exact case and are refused at sentence starts unless list items; `SAFE_ANY_CASE` (`:210`); `SENTENCE_START_AMBIGUOUS`
(`:249`, e.g. "Express"); a term inside a longer one doesn't count ("CI" in "CI/CD"); "American Express" / "TS/SCI"
excluded (`:573-627`). Key functions: `keywordsOf(resume)` (`:804`), `synonymKey(term)` (`:168`),
`scanVocabulary(text)` (`:573`), `isVocabularyTerm` (`:648`).

`services/resumeMatch.ts`: score `S = 0.45·T + 0.55·R` (titles vs keywords); weights 3 for top skills + mustInclude,
2 technical/tools/technologies/protocols, 1 concepts/domain. Simpler, closer-to-Simplify alternative:
`resumeEvidence(resume)` (`services/reviseCoverage.ts:182`), `supportedTerms`/`missingTerms` (`:213`, `:142`),
`containsTerm`/`termPattern` (`tailorContract.ts:48`, `conceptTools.ts:259-265`: alphanumeric lookaround boundaries,
flexible spaces, case-insensitive except ≤2-char terms).

---

# PART B — Simplify Jobs (VERIFIED from client code unless noted)

## B1. Data
- `__NEXT_DATA__` is empty (static export); search runs client-side against Simplify's own index — **TailorIT must not
  use it**.
- **List-card hit fields:** `id, title, company_id, company_name, company_logo, locations[] ("City, ST, Country"),
  type ("Full-Time"…), min_salary, max_salary, salary_period (1 hr, 2 wk, 3 mo, 4 yr, 5 bi-wk), currency,
  updated_date, start_date (epoch s), experience_level[], seasons[], travel_requirements ("Remote"|"Hybrid"|"In Person"),
  sponsors_h1b`.
- **Card rendering:** location "City + N more" or "N locations", then " · " and the work arrangement; salary e.g.
  "$120k - $150k" + "/yr"; relative `start_date` ("2 months ago") or "Updated · …" when sorting by updated; bookmark
  aria-label "Save {title}" / "Remove {title} from saved jobs".
- **Detail object:** `title, subtitles[]` ("Title - a, b"), `type` (Internship/Full-Time/Part-Time/Contract),
  company {name, logo, short_description (tagline), description, url, twitter, linkedin, crunchbase, company_size (1–8),
  funding_stage, funding_total, location, year_founded, sponsors_h1b, benefits…}, `start_date`, `updated_date`, `active`,
  `description` (HTML), `requirements[]`, `responsibilities[]`, `desirable[]`, salary fields, booleans `entry_level,
  junior, mid_level, senior, expert`, `degrees[]`, `locations[]`, `travel_requirements` (1 Remote, 2 Hybrid, 3 In
  Person), `functions[{id,title,parent_function_id}]` (category/subcategory), `sponsors_h1b`, `additional_requirements[]`.

## B2. Filters, sort, paging
- Search placeholder "Find your dream role" (+ saved searches).
- **Top pills:** "Location", "Job Type", "Experience Level", "Category" (each with "Clear {label}"); then "All filters"
  (filter icon), a bookmark ("Save this search"), and "Clear all".

| Section | Filter | Values |
|---|---|---|
| (top) | Last updated | "Past 24 hours" / "Past week" / "Past month" |
| Role | Job type | "Internship", "Full-Time", "Part-Time", "Contract" |
| Role | Experience level | "Entry Level/New Grad", "Junior", "Mid Level", "Senior", "Expert or higher" |
| Role | Category | search-select over category facets with counts (max 50) |
| Role | Leadership | "Individual Contributor", "Manager" |
| Location | Work arrangement | "Remote", "Hybrid", "In Person" |
| Location | Location | free text "City, state, or country"; "Remote in USA/Canada/UK/…" submenu |
| Compensation | Minimum salary | slider $0–$400k, step $10k; Pay period Hourly/Weekly/Monthly/Yearly(default)/Biweekly |
| Company | Sponsors H1B, Industry, Company size ("1-10" … "10,001+"), Funding stage, Company | |
| Your profile | Education level, Security clearance ("Requires security clearance"/"No security clearance required") | |
| Preferences | Hide applied jobs | toggle |

- **Sort:** "Most relevant", "Recently posted", "Recently updated", "Highest salary". Text search covers title, company
  name, functions, locations.
- **Paging:** 21 jobs per page, infinite scroll (IntersectionObserver, rootMargin "0px 0px 150% 0px"); "Load more" only
  after an error; first job auto-selected; count "Found 17,480 jobs"; empty "No matching jobs found"; few results:
  "Only N jobs match your filters. Remove one of these filters to see more results."

## B3. Detail pane
- **Sticky header:** tabs "Overview" | "Company" are scroll anchors that highlight on scroll. Actions:
  "Already Applied?", applied chip `Applied ${M}/${D}/${YY}`, Save/"Saved" (bookmark), hide menu, Apply ("INACTIVE"
  replaces Apply when `!active`).
- **Body:** company header (logo, name, tagline); title `h1`; chips: role type (e.g. "Full-Time") + live chip.
- **Facts grid**, in order: Salary ("No salary listed" when missing); Experience level (with match icon); Degree
  (optional); Location (first + "+N more", description "More locations: a | b"); Work arrangement; Category (top-level
  value, subcategories as description); H1B; Additional requirements.
- **"About the job"** + "Summary" | "Full posting" toggle: Summary = "Requirements", "Responsibilities",
  "Desired Qualifications" bullet lists; Full posting = sanitized description HTML.
- **Right rail:** resume keyword card, then referrals (out of scope).
- **Company section:** "About the company" (logo, links, description); stats Company Size, Company Stage, Total Funding,
  Headquarters, Founded.

## B4. Keyword score and experience-level match
- Help article: "Simplify analyzes the skills, qualifications, tools, and language emphasized in a job description,
  then compares them against the resume … The result is shown as a percentage score alongside a breakdown of matched
  and missing keywords … aiming for around 70% keyword coverage or higher."
- **Job keywords:** server returns `high_priority_keywords` and `low_priority_keywords`; each item = an array of
  alternative spellings (first = label) or `{keyword, patterns[]}`. Signed-out fallback: a dictionary (hard skills,
  languages, soft skills, tools/frameworks) with whole-word regex `(^|\W)term($|\W)`; <16 hits: high = tools +
  languages + hard skills, low = soft; ≥16: high = tools + languages, low = hard skills, soft dropped.
- **Matching:** resume text whitespace-collapsed + lowercased; a keyword matches if any spelling matches as a whole
  word. `matching` = high then low then custom hits; `missing` same order; `count` = total;
  `percentage = round(matched/count·100)`.
- **The card:** title "Improve your resume" (target icon); text `<b>{matching.length} out of {count}</b> required
  keywords found`; chips matched first (highlighted, check-circle) then missing (plain); collapsed to 2 rows, toggle
  `Show ${hidden} more` / "Show less" (hidden = chips that didn't fit). CTA "Tailor my resume" — **TailorIT: hidden**.
  States: "Add a resume" / "Upload or create a resume and we'll score it against this job's keywords."
- **Experience-level check:** posting flags `[entry_level, junior, mid_level, senior, expert]` → ["Entry", "Junior",
  "Mid", "Senior", "Expert"] vs user preferences. Overlap → green check-circle "Your experience level matches one of the
  following: …". No overlap → amber info icon: "This job asks for: … / You're looking for: … / You can still be a good
  fit — employers often consider adjacent experience levels." No preferences → no icon.

## B5. "Confirmed live in the last 24 hours" (client rule)
With a = now − 7 days: inactive or posted within 7 days → "Posted on {date}"; else updated within 7 days →
"Updated on {date}"; else "Confirmed live in the last 24 hours" (clock icon, tooltip "Posted on …"). Requires a daily
backend check keeping `active` accurate (TailorIT: `last_verified_at` from ATS polls).

---

# PART C — Recommendation (adopted in ARCHITECTURE.md)
- Job sources: public ATS boards (Greenhouse, Lever, Ashby — verified live 2026-10-22), CSV/JSON import (incl. free_tailor
  sheet columns), free_tailor lake (read-only), demo seed.
- One row per posting: unique `(source, source_job_id)`, then `linkKey`/`contentHash`. Never the lake's company+field hash.
- Analysis once per posting (cache by content hash): display bullets (requirements/responsibilities/desired),
  high/low keyword groups with synonyms, experience levels, employment type, work model, salary, category/subcategory.
  Free deterministic fallback via vocabulary scan. Match locally per view.
- Level mapping from free_tailor seniority words: intern → Internship; junior → Junior/Entry; mid → Mid Level;
  senior → Senior; staff/principal/lead/director/vp → Expert or higher.
