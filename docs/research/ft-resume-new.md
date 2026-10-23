# ft-resume-new: free_tailor's "new resume" logic, mapped for TailorIT

Key: `ft-resume-new`. Source: local clone `F:/Develop/free_tailor` (branch v5.0 = v4.2, commit 4112e8e, clean tree), read-only.
All paths below are relative to that repo unless they start with a drive letter. `fe/` = `frontend/src/`, `be/` = `backend/src/`.

**Evidence labels.** Every free_tailor statement was read in the source at the file:line cited (treat as VERIFIED-in-source).
The few statements about Simplify are labelled VERIFIED / REPORTED / INFERRED / UNKNOWN as the task requires. This report is
about free_tailor; Simplify's look is covered by the `simplify-*` reports.

---

## 0. TL;DR (the facts the architecture depends on)

1. **The new-resume flow is three screens.** (a) Template chooser `/admin/resumes/new[?profile=<id>]`; (b) the editor for a new
   resume `/admin/resumes/new?template=<id>[&layout=flat][&profile=<id>]`, which first asks "Import your existing resume"
   (Import resume = PDF read by AI / Start from blank); (c) the editor for a stored resume `/admin/resumes/<id>`. Nothing is
   saved until **Create Resume** / **Save Resume** (except a PDF import, which the server saves immediately).
   Files: `fe/app/admin/resumes/new/page.tsx`, `fe/app/admin/resumes/[id]/page.tsx`, `fe/components/resume/*`.
2. **One JSON document per resume** in SQLite table `resumes` (`id, name, disabled, data, created_at, updated_at, owner_id,
   profile_id`), read/written through `DocumentTable<Resume>` (`be/database/documentTable.ts`). The whole `Resume` object
   (15 section kinds + custom sections + `sectionOrder` + `resumeSettings`) lives in `data`.
3. **Every resume is filed under a "profile" = a PERSON** (`profiles` table). Placement is server-side only:
   `?profileId=` query param, else the owner's oldest profile with the same person key (normalized name), else a NEW profile
   (the only step that counts the subscription's profile limit -> 402 `profile-limit`). This is a bidding-agency concept; a
   single-person job-seeker app (TailorIT/Simplify-like) probably wants to collapse it (Open question Q1).
4. **The live preview is server-rendered HTML**, not a client renderer: `POST /api/resumes/preview` -> Handlebars template ->
   full HTML document with a CSP meta -> shown in a sandboxed `srcdoc` iframe scaled to the pane, redrawn ~400 ms after
   typing stops. **No Chrome is needed for preview or thumbnails** - only for PDF.
5. **Thumbnails are live iframes too**: resume cards call the same preview route with `{ resume: {}, resumeId, sample: false }`;
   template gallery cards frame `GET /api/templates/:id/preview?layout=` (cookie-authenticated `src`).
6. **There is NO "Download PDF/DOCX" for a resume in free_tailor v4.2.** `generateResumePDF` (Puppeteer) and
   `generateResumeDOCX` (html-to-docx) are only called by the tailoring/generation queue (`be/services/queue/resumeTask.ts:372-394`)
   and write to the run's output folder. The only export of a stored resume is **Download JSON** (dashboard menu).
   TailorIT's Documents page will need a new export endpoint (Risk R3).
7. **Two AI calls in this flow**, both via the CLI "subscription seats" (`claude` / `codex` / `gemini` CLIs; no API keys):
   `extract-profile-from-resume` (PDF import) and `write-entry-bullets` (Write with AI / Improve with AI). Both are free
   (no credits). Prompt files: `backend/static/prompts/extract-profile-from-resume.json`, `write-entry-bullets.json`.
8. **The cut line runs through four functions that live in the tailoring module**: `extractResumeFromText` and `cleanBullets`
   (`be/services/resumeService.ts:1162`, `:447`), `getTemplateById`/`getAllTemplates` (`be/extractors/templateExtractor.ts`,
   which also imports `extractTemplateFromPDF` from resumeService), and `normalizeAiPreferences` (`be/config/aiPreferences.ts`,
   which imports the 2,688-line `be/config/aiModelConfig.ts`). Because of these, the naive import closure of
   `be/routes/resumes.ts` is **119 backend files** (tailoring, credits, subscriptions, all three CLI seats). Carving 4-5 small
   modules out shrinks it to roughly 35 (section 8.4).
9. **The editor UI is FlowCV-styled**, not Simplify-styled: warm desk `#f3f1ec`, plum `#200e32`, pink `#ec058a`, gradient
   `linear-gradient(90deg, #ec008c 0%, #fc6767 100%)`, DM Sans (`fe/components/resume/resumeEditor.module.css:28-66`). All colors
   are `--ed-*` tokens on `.editor`/`.tokens`, so re-skinning to Simplify's palette is a token swap plus a few shape tweaks (Q4).
10. **The frontend keeps pure, type-only helper libs** (`lib/resumeDraft.ts`, `lib/sectionCatalogue.ts`, `lib/previewPane.ts`,
    `lib/resumeGallery.ts`, `lib/profileDashboard.ts`) that the backend test suite transpiles and runs against the server copies
    (drift tests). `lib/sectionCatalogue.ts` is a hand-kept mirror of `be/config/sectionCatalogue.ts`.

---

## 1. Vocabulary and where things live

| Word | Meaning in v4.2 | Type / table / route | Source |
|---|---|---|---|
| resume | one resume document | `Resume` (`be/types/resume.ts:203-301`), table `resumes`, `/api/resumes` (`be/routes/resumes.ts`) | CLAUDE.md:2074-2077 |
| profile | a PERSON, holds that person's resumes | `Profile`, `ProfileSummary` (`be/types/profile.ts`), table `profiles`, `/api/profiles` | CLAUDE.md:2063-2108 |
| account | the signed-in user | table `users`, `/api/auth/*` | CLAUDE.md:2078 |
| template | a Handlebars HTML document (JSON file) | `Template` (`be/types/template.ts:33-79`), files `backend/static/templates/*.json`, `/api/templates` | CLAUDE.md:2027-2061 |
| tailored content | what the AI wrote for one job (NOT part of new-resume) | `TailoredContent` (`be/types/template.ts`) | - |
| builder | Build Resumes page (tailoring runs) - NOT part of new-resume | `fe/app/page.tsx`, `/api/resume/*`, `/api/generation/*` | CLAUDE.md:1821-1949 |

Pages (App Router, all under `/admin/...` even though every builder account uses them):

| Route | File | What |
|---|---|---|
| `/admin/profiles` | `fe/app/admin/profiles/page.tsx` (609 lines) | "My Profiles" dashboard: tabs Profiles / All resumes, Grid / List, search, Import, Create New |
| `/admin/profiles/[profileId]` | `fe/app/admin/profiles/[profileId]/page.tsx` (451) | one person's resumes, New resume, Import resume |
| `/admin/resumes/new` | `fe/app/admin/resumes/new/page.tsx` (213) | template chooser, or new-resume editor when `?template=` present |
| `/admin/resumes/[id]` | `fe/app/admin/resumes/[id]/page.tsx` (69) | editor of a stored resume |

`fe/app/admin/layout.tsx:17-30` gives exactly these routes (`isProfilesDeskRoute`, `fe/lib/profileDashboard.ts:59-61`, regex
`^\/admin\/(?:profiles(?:\/[^/]+)?|resumes\/[^/]+)\/?$`) a bare `<main className="tl-fill">`; every other admin page gets the
centred `max-w-7xl` column.

---

## 2. User flow, screen by screen

### 2.1 Where a new resume starts (entry points)

| Entry point | File:line | What it does |
|---|---|---|
| Dashboard "New resume" dashed tile / "Create New" on All resumes tab | `fe/app/admin/profiles/page.tsx:193-196`, `:329-332`, `:486` | exactly 1 profile -> `router.push(newResumeHref(profiles[0].id))`; else opens **NewResumeDialog** |
| NewResumeDialog ("New resume", subtitle "Which profile is the new resume for?" or, with no profiles, "A resume lives in a profile: the person it is for. Name that person first.") | `fe/components/profiles/ProfileDialogs.tsx:479-596` | radio list of profiles + "A new profile" (locked at limit) -> optional `profilesApi.create({name})` -> `onPicked(profileId)` -> chooser |
| Profile card ⋮ "New resume" | `fe/components/profiles/ProfileCards.tsx:76-88` (`profileMenuItems`) | `router.push(newResumeHref(profile.id))` |
| Profile page "New resume" button / dashed tile | `fe/app/admin/profiles/[profileId]/page.tsx:245`, `:311-314`, `:370` | `newResumeHref(profile.id)` = `/admin/resumes/new?profile=<id>` |
| Import (dashboard) -> Resume PDF / Resume JSON file | `fe/app/admin/profiles/page.tsx:198-219`, `:289-313` | `useResumeImport()` with no profile: server files each resume by person name |
| Import resume (profile page) | `fe/app/admin/profiles/[profileId]/page.tsx:247-263`, `:333-356` | `useResumeImport(profile.id)` |
| "Duplicate" on a resume's ⋮ | `fe/components/profiles/useResumeActions.tsx:152-182` | `resumesApi.create(duplicateResumeBody(resume, ai), {profileId})` - keeps the template |

`newResumeHref(profileId?)` = `'/admin/resumes/new?profile=' + encodeURIComponent(id)` or `'/admin/resumes/new'`
(`fe/lib/profileDashboard.ts:69-72`). Old bookmark `/admin/profiles/new` is `router.replace`d to `/admin/resumes/new` + query
(`fe/app/admin/profiles/[profileId]/page.tsx:114-116`).

### 2.2 Screen A - the template chooser (`/admin/resumes/new` without `template`)

Component `TemplateChooser` (`fe/components/resume/TemplateChooser.tsx:49-219`), mounted by `NewResume`
(`fe/app/admin/resumes/new/page.tsx:173-211`) inside `<div className={editorCss.editor + editorFont.variable}>`.

Data loaded on mount: `templatesApi.getAll()` -> `GET /api/templates` (enabled only), and when `?profile=` is present
`profilesApi.get(id)` -> `GET /api/profiles/:id` (`new/page.tsx:77-103`). A 404/403 on the profile means "start with no
profile named" (`new/page.tsx:109-111`).

Exact UI (strings verbatim):

- Back link: profile name -> `/admin/profiles/<id>`, else **"My Profiles"** -> `/admin/profiles` (`TemplateChooser.tsx:106-109`).
- `h1`: **"Start building a resume"** or **"Start building a resume for {name}"**; subtitle **"Choose a design you like. You can
  customize or switch it later."** (`:110-111`).
- Filter pills (role=group aria-label "Show templates", `aria-pressed`): **All Templates**, then **Simple / Modern / Creative**
  only for categories some offered template has (`fe/lib/resumeGallery.ts:24-46`).
- **"Import existing resume"** button = `ActionMenu` with two items (`TemplateChooser.tsx:127-152`):
  **"Resume PDF"** (hint "An AI reads it into a new resume. Up to {uploadMaxMb} MB.") and **"Resume JSON file"**
  (hint "A resume downloaded from this app, or several."). Busy labels: "Reading your resume..." / "Importing...".
- Grid of template pages (`ul.templateGrid`, 6 shimmer placeholders while loading, `LOADING_CARDS = 6`). Each card = `PageThumb`
  framing `${getApiOrigin()}/api/templates/<id>/preview?layout=categorized` + a full-size cover button (aria
  "{name}: see the template") with hover label **"Preview"**; name under it (`:172-205`).
- Empty state (list loaded but empty): "No template is offered on this installation yet." + link **"Start without a template"**
  -> `/admin/resumes/new?template=[&profile=]` "- resumes are drawn with the default one until a template is chosen." (`:157-170`).
- Notices under the toolbar (page-level, `new/page.tsx:186-209`): while a PDF is read: **"Reading your resume with AI. This can take
  a minute; its editor opens when it is done."**; after a multi-resume JSON import: **"Imported N resume(s) from {file}. {k} kept the
  id from the file."** + link **"See your resumes"**; errors via `ErrorNotice` + `ProfileLimitLink` ("Go to subscription").

Template **details dialog** (`TemplateDetails`, `TemplateChooser.tsx:238-377`; own chrome, portalled to body, joins the dialog
stack via `useDialogLayer`):

- Left: the page large (`PageThumb` with `lazy={false}`, src includes `&layout=flat` when Plain is chosen).
- Right: name (h2), description, label **"Technical skills"** + switch (role=group aria-label "Technical skills") **Grouped** /
  **Plain** (opens on Grouped), features list (`templateFeatures`, `fe/lib/resumeGallery.ts:63-83`): "A4 page, print-ready PDF",
  "Technical skills grouped under headings, or as one list", "Soft skills and strengths sections" | "A soft skills section" |
  "A strengths section", "Projects, languages, awards and sections of your own", "Sections in the order you arrange them",
  "Switch to another template any time"; button **"Use this template"** (never disabled); Previous / Next steps (template names)
  and ArrowLeft/ArrowRight (ignored while focus is in the layout switch); Close (×).
- **Use this template** -> `router.push(startResumeHref(template.id, layout, carriedProfile))`
  (`new/page.tsx:181`; `startResumeHref` `fe/lib/resumeGallery.ts:95-105`: `?template=<id>`, `&layout=flat` only for Plain,
  `&profile=<id>` when given).

### 2.3 Screen B - a new resume's editor (`/admin/resumes/new?template=...`)

`readStartChoice({template, layout}, templates)` (`fe/lib/resumeGallery.ts:130-140`): no `template` param -> chooser; `template=`
empty -> start with no template (`templateId: ''`, drawn with `default`); a template id not in the enabled list -> chooser again;
`layout=flat` -> Plain else Grouped. While the template list is loading the page shows "Loading the template..."
(`new/page.tsx:117-123`); if the list failed, the address is trusted as-is (`:126-127`).

Then `<ResumeEditor key="{templateId}:{layout}:{profile}" resume={null} profileId={profileParam} start={{...choice, offerImport: true}} />`
(`new/page.tsx:130-141`). The initial draft is `draftForNewResume(start)` = an empty draft with `preferredTemplate` and
`technicalSkillsLayout` set (`fe/lib/resumeDraft.ts:371-378`).

**ImportStartDialog** opens immediately (`fe/components/resume/ImportStartDialog.tsx:25-106`; mounted at `ResumeEditor.tsx:932-941`):

- Title **"Import your existing resume"**, subtitle **"Start faster by prefilling your resume content."**
- Buttons **"🚀 Import resume"** (primary) and **"✍️ Start from blank"**.
- Note: "A resume PDF under {N} MB. An AI reads it into a new resume on {templateName}, saved as soon as it is read, and the
  editor opens on it for you to look over." Busy: "Reading your resume. This can take a minute." then "Opening your new resume...".
- Import resume: `chooseFile('.pdf,application/pdf')` -> `useResumeImport(profileId).importPdf(file)` -> `POST /api/resumes/upload`
  (multipart field `resume`, `?profileId=`) -> 201 Resume (already SAVED) -> if a template was chosen,
  `resumesApi.update(id, { preferredTemplate, resumeSettings: { technicalSkillsLayout } })` (failure ignored) ->
  `router.replace('/admin/resumes/<id>')` (`ImportStartDialog.tsx:47-64`).
- Start from blank / Close / Escape / backdrop -> closes, empty editor stays (not closable while working).

### 2.4 Screen C - the editor (new or stored)

`ResumeEditor` (`fe/components/resume/ResumeEditor.tsx:162-944`) owns the draft. Mounted by `[id]/page.tsx:68` with
`resume={loaded}` after `GET /api/resumes/:id` (spinner "Loading the resume..."; failure "Could not load this resume" + "Back to
profiles").

On mount it loads (`ResumeEditor.tsx:215-262`): `GET /api/profiles/:id` (the resume's or requested profile; 404/403 tolerated),
`GET /api/templates`, `GET /api/prompts`, `GET /api/resume/skills?type=hard` (whole hard-skill library into a `<datalist
id="resume-hard-skill-library">`), `GET /api/resume/models`.

**Layout** (`ResumeEditor.tsx:727-942`, CSS `resumeEditor.module.css`):

```
.editor (desk, min-height calc(100dvh - --tl-topbar-h))
 └ .desk (max-width 105rem)
    ├ h1.sr-only  "Edit Resume" | "New Resume"
    ├ .bar (sticky top: --tl-topbar-h; z: --layer-page-toolbar)
    │   [▦ {profile name | "Profiles"}]  [Content] [Customize]  ... {save state}  [Create Resume | Save Resume]
    │   (<1100px) [Form] [Preview]   + profile-missing warning + save error
    └ .workspace (grid: 1 col; >=1100px: minmax(0,1fr) minmax(0,1.08fr))
        ├ form#resume-editor-form.formPane (container-type: inline-size)
        │   ├ tabpanel "Content"  -> EditorHeaderCard, section cards (drag/move), "+ Add content"
        │   │                        (or BasicsPanel / EntryEditor in the column's place)
        │   └ tabpanel "Customize" -> TemplateCard, LayoutCard, GenerationSettingsCard, KeywordsCard
        └ aside.previewPane (sticky) -> ResumeDraftPreview
```

Bar strings (`ResumeEditor.tsx:732-811`): back button title "Back to {name}" | "My Profiles"; tablist aria-label "Editor views"
with tabs **Content** (IconDocument) / **Customize** (IconPalette), ArrowLeft/Right switch tabs; save state `aria-live`:
**"Unsaved changes"** (pink dot) | **"No changes yet"** (stored) | **"Nothing entered yet"** (new); submit button (outside the
form, `form="resume-editor-form"`): **"Create Resume"** / **"Save Resume"** ("Resume" hidden on phones), **"Saving..."** while
busy; narrow switch (role=tablist aria-label "Editor") **Form** / **Preview**; a new resume whose `?profile=` is not readable
warns: "The profile this resume was started for was not found. It may have been deleted, or it is not yours, so saving here will
be refused. Go back to My Profiles and start the resume from one of your profiles."

Both tab panels stay MOUNTED (`hidden` attribute), so all inputs keep state and pinned ids stay in the DOM.

#### Content tab

- **Header card** (`fe/components/resume/EditorHeaderCard.tsx:37-77`): name ("Your name" placeholder text), title ("Your
  professional title"), one line per non-empty contact field with icon (email, phone, location, linkedin, github, portfolio;
  "No contact details yet"), initials avatar circle (no photo is ever printed), round pencil (aria "Edit name and contact details")
  -> **BasicsPanel**.
- **BasicsPanel** (`fe/components/resume/ContentCards.tsx:146-218`): `EditorPanel` titled **"Name and contact details"**, eyebrow
  **"Personal details"**; fields (2-up at container `@lg`): **Full name** (`#resume-name`), **Professional title**
  (`#resume-title`), **Total years of experience** (`#resume-years`, number, step 0.5, hint "Given to tailoring; not printed by
  itself."), **Email**, **Phone**, **Location**, **LinkedIn URL**, **GitHub URL**, **Portfolio URL** (`#resume-contact-<key>`; URL
  fields are `type=text inputMode=url` on purpose). Placeholders = the sample person's text (`SAMPLE_PLACEHOLDERS`,
  `fe/lib/resumeDraft.ts:990-1004`: "Jordan Avery Chen", "Senior Software Engineer", "jordan.chen@example.com",
  "+1 (555) 123-4567", "San Francisco, CA", "linkedin.com/in/jordanchen"). Footer **Done** (gradient, tick).
- **Section cards** in the order `effectiveSectionOrder(draft.sectionOrder ?? [], template.nativeSectionOrder ??
  DEFAULT_SECTION_KINDS, presenceOf(draft))` (`ResumeEditor.tsx:453-455`; algorithm `fe/lib/sectionCatalogue.ts:674-701`).
  Each card is a `SectionCard` (`fe/components/resume/SectionCard.tsx:54-148`): `section > h2 > button[aria-expanded]` head with
  chunky icon, label, count meta ("3 entries", "12 skills"...), CLOSED by default (a card just added opens and takes focus), body
  always mounted (`hidden`), on hover/focus: grip (drag), Move up / Move down arrows, Remove section bin (non-default kinds and
  custom sections only). Wrapped in `SectionSlot` (`fe/components/resume/SectionSlot.tsx:26-109`): native HTML5 drag & drop,
  `draggable` only while the grip is pressed; drop edge before/after by pointer half; dropping turns `sectionOrder: null` into the
  displayed list.
- Card kinds (`renderCard`, `ResumeEditor.tsx:600-725`):
  - **Summary** (`SummaryCard`, `ContentCards.tsx:26-41`): one textarea `#resume-summary`.
  - **Technical skills** (`TechnicalSkillsCard`, `fe/components/resume/SkillCards.tsx:25-136`): AddInput "Add a hard skill"
    (`#resume-hard-skill-input`, datalist = library) -> `ensureLibrarySkill` (library spelling, else `POST /api/resume/skills/confirm`)
    -> chip list (tone sky); in Grouped layout each chip carries a heading `<select>` ("Work it out" + the 17
    `HARD_SKILL_CATEGORIES` + headings already used).
  - **Soft skills** (`SoftSkillsCard`, `SkillCards.tsx:138-228`): switch `#resume-include-soft-skills` **"Print a Soft Skills
    section"**; off -> "N soft skills kept with the resume. Tick the box to print and edit them."; on -> AddInput (max 50 x 100 chars).
  - **Strengths** (`EntrySection` with header, `ResumeEditor.tsx:665-707`): switch `#resume-include-strengths` **"Print a Strengths
    section"**; rows only while on.
  - **Interests** (`InterestsCard`, `ContentCards.tsx:44-105`): chip list, max 50 x 100.
  - **Every entry kind + custom sections** (`EntrySection`, `fe/components/resume/EntrySection.tsx:24-135`): rows (title bold, meta
    second line, chevron) -> opens **EntryEditor**; dashed **"+ Add {entryNoun}"** (`AddRowButton`) appends an empty row and opens it.
    Custom section cards also edit their title ("Section title", placeholder "e.g. Patents", max 100).
  - Template capability notes: `NotPrintedNote` ("{template} has no {label} section, so these entries are not printed with it...")
    and `SwitchCapabilityNote` (`fe/components/resume/parts.tsx:188-236`).
- **EntryEditor** (`fe/components/resume/EntryEditor.tsx:42-349`): `EditorPanel` titled **"Edit {entryNoun}"**, eyebrow = section
  label, bin (aria "Delete this {noun}") asks "Delete this {noun}? It is removed when you save the resume." unless blank; fields from
  `spec.fields` (section 4.4); Experience adds **"Skills used"** (adds to the role AND to Technical skills); kinds with bullets add
  **"Achievements, one per line"** textarea + count note ("N bullets. A tailored resume prints at most 8, ..."); Done drops a
  wholly blank row.
- **Write with AI** (experience, project, volunteering) - section 2.5.
- **"+ Add content"** (`fe/components/resume/AddContentDialog.tsx:24-123`): kit Dialog title **"Add content"**, subtitle "A section
  prints once it has an entry; an empty one stays on the page and is saved with the resume."; one tile per kind not yet shown and not
  default (Projects, Volunteering, Awards, Publications, Courses, Languages, Interests, References - Certifications is a default card),
  each with icon, label and blurb; a **Custom section** tile with title input ("Section title, e.g. Patents") + Add (max 10 custom
  sections: "A resume can have at most 10 custom sections."). Adding appends to the order (`addSectionKind`/`addCustomSection`,
  `fe/lib/resumeDraft.ts:628-640`). New custom key = `cs-` + 8 hex (`newCustomSectionKey`, `fe/lib/sectionCatalogue.ts:559-569`).
- **Remove section** confirms "Remove {label} and its N entries? They are deleted when you save." (`ResumeEditor.tsx:528-539`).

#### Customize tab (four `SettingsCard`s, `parts.tsx:285-306`)

- **Template** (`fe/components/resume/TemplateCard.tsx:36-114`): "How the resume looks. The preview redraws as soon as you pick one.";
  select `#resume-template` **Design template** listing every enabled template (stale id shown as "{id} (no longer available)");
  pills "Strengths section"/"No Strengths section", "Soft Skills section"/"No Soft Skills section".
- **Layout** (`TemplateCard.tsx:123-174`): "How Technical Skills is laid out, and the order the sections print in."; radios
  `#resume-layout-categorized` **Grouped** ("Skills under headings. A tailored resume prints the groups written for the job, as
  written.") / `#resume-layout-flat` **Plain** ("One list of skill names with no headings over it - a tailored resume's groups run
  together, repeats removed."); hint "Sections print in the order of the cards on the Content tab, within the column the template
  puts each one in - a sidebar template keeps Skills in its sidebar wherever its card sits."; **"Use the template's order"** (only
  while an own order is stored) -> `sectionOrder: null`.
- **Generation** (`fe/components/resume/GenerationSettingsCard.tsx:60-148`) - TAILOR-FACING: model select (`AiPreferenceFields`,
  inherit option "Use the app default ({model})"), **Building prompt** (`tailor-resume` prompts; hint "Used when this resume is built
  with Partial Tailor. Fully Tailor runs Tailor Resume (Fully); Choose Suitable Resume builds the resume as written."), **Resume file
  name** / **Cover letter file name** (tokens `{{profile_name}}, {{company_name}}, {{role}}, {{row_number}}, {{date}},
  {{order_number}}, {{user_email}}`).
- **Keywords** (`fe/components/profiles/KeywordsCard.tsx:14-23`) - TAILOR/MATCHER-FACING, read-only chips of
  `resume.matchKeywords` ("Job titles", "Skills and technologies"; "Keywords appear once the resume is saved.").

### 2.5 Write with AI / Improve with AI

UI in `EntryEditor.tsx:259-349` (`Bullets`), hook `fe/components/resume/useWriteBullets.ts:28-72`, request builder
`fe/lib/resumeDraft.ts:881-960`.

- Button label **"Write with AI"** when the box has no bullets, **"Improve with AI"** when it has (`bulletsTask`).
- Disabled with a sentence when the entry has nothing naming it (`bulletsBlocker`): "Give the role a title or a company before asking
  for bullets." / "Give the project a name before asking for bullets." / "Give the volunteering entry a role or an organisation before
  asking for bullets."
- Optional one-line note input (aria "A note for the AI (optional)", placeholder "Optional: what to bring out, e.g. the cost
  savings", maxLength 300; Enter sends).
- Request: `POST /api/resumes/entries/bullets` with `{ kind, entry: {named fields, startDate, endDate, location, description,
  achievements[], skills[]}, resume: { name, title, totalYearsExperience?, summary, skills }, task, instructions? }`.
- Spinner "Writing the bullets..." / "Improving the bullets..."; textarea disabled while running; one AbortController (second press
  aborts the first; unmount aborts).
- Success replaces the box text (one bullet per line) and shows **"Bullets written."** / **"Bullets improved."** + **Undo** (while the
  box still equals the answer). Failure -> `ErrorNotice` with the server sentence.
- Server: `be/services/entryBullets.ts:218-263`: validates kind/task/entry, `inFlight` Set per account (409 `already-running`: "A Write
  with AI request is already running for your account. Wait for it to finish, then try again."), resolves the **app default model**
  (`resolveRequestedAIModel()`), runs prompt `write-entry-bullets` (maxTokens 1200, temperature 0.3, JSON), parses `{bullets}`, then
  `finishBullets` = `cleanBullets` (tailoring's sanitizer) + strip leading `-*•`, max 8 bullets x 300 chars. Nothing is stored.

### 2.6 The live preview

`ResumeDraftPreview` (`fe/components/resume/ResumeDraftPreview.tsx:126-364`), fed `previewRequest = { resume:
draftToPreviewResume(draft, HARD_SKILL_CATEGORIES), resumeId? }` (`ResumeEditor.tsx:346-352`).

- Debounce: 0 ms for discrete changes (`update(..., {immediate: true})`: template, layout, switch, reorder, add/remove), 400 ms for
  typing (`TYPING_DEBOUNCE_MS`, `ResumeEditor.tsx:96`); first render immediate; nothing sent while hidden (narrow layout on Form) or
  when the JSON key equals the rendered one; stale requests aborted; sequence numbers drop late answers (`:160-184`).
- Two swapping `<iframe srcDoc sandbox="allow-same-origin" scrolling="no">` frames: the new document loads hidden and is swapped in
  after `onLoad` + measuring `scrollHeight` - the last good page stays up on error (`:41-80`, `:246-272`).
- Scale = `min(1, paneWidth / page.widthPx)`; pane width computed by `stablePaneWidth` (`fe/lib/previewPane.ts:72-81`) as if the
  scrollbar were always there (prevents a scrollbar feedback "shake"); CSS `scrollbar-gutter: stable` on the well and on `html` while
  the editor is shown (`resumeEditor.module.css:1689-1722`).
- Head line: template name (`p.truncate`), status **"Up to date"** / **"Updating..."** / **"Not updated"** (dot), **"Full size"**
  button -> `PreviewViewer` portal ("Resume preview" / "{template} - at the size it prints", Close, Escape) (`:283-308`, `:367-428`).
- Approximate page-break dashed lines "Page 2", "Page 3"... every `page.contentHeightPx` (`pageBreaks`, `:106-122`).
- Notes (`ResumeEditor.tsx:354-378`): sample notice **"Sample text shown for: name, phone, experience. It fills what is empty, here
  only: it is never saved, printed or sent to tailoring."** (`sampledNotice`, `fe/lib/resumeDraft.ts:1035-1044`), and when the server
  drew another template: "Drawn with {name}: the template this resume names is not offered any more. A generated resume falls back the
  same way."
- Error: `ErrorNotice` "Could not draw the preview" + "The page below is the last one that rendered." + **Try again**.

### 2.7 Save

`handleSubmit` (`ResumeEditor.tsx:404-437`):

1. `ai = savableModelChoice(draft.settings.ai, {modelsLoaded, offeredIds, storedModelId})` (`fe/lib/resumeModelChoice.ts:22-30`).
2. `payload = draftToPayload(draft, ai, HARD_SKILL_CATEGORIES)` (`fe/lib/resumeDraft.ts:761-781`): EVERY list is sent (an omitted list
   would keep the stored one), blank rows dropped, `achievementsText` split by line into `achievements[]`, `skillCategories` rebuilt
   from the per-skill heading map in library order, `sectionOrder: []` when following the template, all settings named.
3. New: `POST /api/resumes?profileId=<id>` (or no query) -> 201 Resume, then `refresh()` (`GET /api/auth/me`);
   stored: `PUT /api/resumes/:id` -> 200 Resume.
4. `router.push(profilePageHref(savedUnder))` - i.e. after save the user lands on the PROFILE page, not back in the editor
   (fallback `/admin/profiles`). `saving` stays true during navigation (no double submit).
5. On error: `ErrorNotice` under the bar (+ `ProfileLimitLink` for 402 `profile-limit`, after which the session is re-read).

Leaving: `beforeunload` prompt while dirty (`:274-281`); Back button confirms **"Leave without saving? The changes you made to this
resume will be lost."** (`:380-385`). Dirty = `JSON.stringify(draft) !== JSON.stringify(initial)` (`:184`, `:269`). Rail links do not
ask (App Router cannot hold a navigation).

### 2.8 Export - what exists and what does not

- **Download JSON** (resume ⋮ menu): `saveTextFile(resumeExportFileName(resume), resumeExportText(resume))` - the resume less
  `profileId`/`matchKeywords`, pretty-printed (`fe/lib/resumeGallery.ts:185-207`, `fe/components/resume/ResumeCards.tsx:322-337`).
  Import JSON takes it back.
- **Duplicate** (⋮): copy in the same profile on the same template (`fe/lib/resumeGallery.ts:174-178`).
- **No PDF/DOCX download of a resume** anywhere in the profile/resume pages (grep of `fe/components/resume`, `fe/components/profiles`,
  `fe/app/admin/resumes`, `fe/app/admin/profiles` finds none). PDF/DOCX are produced only by a generation run
  (`be/services/queue/resumeTask.ts:368-394`), which needs a job (tailored) or the "Choose Suitable Resume" mode (as written) and is
  filed under the run's output folder and downloaded per task from `/api/generation/batches/:id/tasks/:taskId/:kind`.
  -> TailorIT must add an export route (see 6.4 and Risk R3).

### 2.9 Import flows (details)

`useResumeImport(profileId?)` (`fe/components/resume/useResumeImport.ts:54-125`), shared by chooser, ImportStartDialog, dashboard,
profile page.

| | PDF | JSON |
|---|---|---|
| Client checks | type `application/pdf` or `.pdf` ("Please upload a PDF file."); size `< uploadMaxMb` MB with a fresh re-check before refusing (`fe/lib/upload.ts:44-79`; message "{file} is {N} MB or larger; this server accepts PDFs under {N} MB. Choose a smaller PDF.") | parsed in the browser (`readResumeImportFile`, `fe/lib/api.ts:2468-2481`: "{file} is not valid JSON. Export a resume from this app, or check the file.") |
| Call | `POST /api/resumes/upload?profileId=` multipart field `resume` | `POST /api/resumes/import?profileId=` JSON body = parsed document |
| Server | multer memory, cap `UPLOAD_MAX_MB` (default 10; 413 `upload-too-large`); profile checked BEFORE the AI call; `pdf-parse` text; `< 50` chars -> 400 "Could not extract text from PDF. Please ensure the PDF contains readable text."; `extractResumeFromText(text)` (AI) -> `buildNewResume` -> `createResumes` | `buildImportedResumes` (gate: each entry needs `name` and at least one resume field; max 50 per file; keeps a free id; reads v4.1 `profiles` list and `profileSettings`) -> `createResumesWithProfiles` (one transaction, all or nothing) |
| Answer | 201 `Resume` | 201 `{ resumes, imported, keptIds, profileIds, createdProfiles: [{id,name}] }` |
| After | `refresh()`; chooser/dialog opens `/admin/resumes/<id>` | 1 resume -> its editor; several -> notice with "See your resumes" |

### 2.10 The resume list views (Documents -> Resumes in TailorIT)

The user asked that TailorIT's Resumes follow free_tailor's list view and thumbnail view. These live on the profile pages:

- **Grid (thumbnail) view**: `ul.resumeGrid` (`repeat(auto-fill, minmax(min(100%, 13.75rem), 1fr))`, 2-up under 640px;
  `fe/components/resume/resumePages.module.css:125-137`), first cell the dashed **NewResumeTile** ("New resume" / "Start from a
  template", `data-new-tile="resume"`, `ResumeCards.tsx:27-44`), then one **ResumeCard** per resume (`ResumeCards.tsx:205-265`): first
  page thumbnail (link to editor, aria "Edit {label}"), ★ **Default** / **Disabled** badges, title = `resumeLabel` (headline unless empty
  or "Professional", else name, else "Untitled resume"; `fe/lib/profileDashboard.ts:92-96`), optional profile link, meta **"Edited 6 hours
  ago · {template}"** (`editedAgo`, `fe/lib/resumeGallery.ts:153-163`; ≥7 days prints the date), template-fallback warning, ⋮ menu.
- **List view**: `ul.list` with header row ("Resume | Name on resume | Template | Edited" on a profile page; "Resume | Profile | Template |
  Edited" on All resumes) and **ResumeRow**s (`ResumeCards.tsx:272-319`; grid `minmax(0,2.2fr) minmax(0,1.4fr) minmax(0,1.4fr) 10rem
  2.5rem`, `fe/components/profiles/profiles.module.css:290-292`).
- **ViewToggle** "View: [grid][list]" (aria-pressed), remembered in `localStorage['freeTailor.profiles.view']`
  (`fe/components/profiles/ViewToggle.tsx:23-67`, `fe/lib/profileDashboard.ts:29-50`).
- **SearchBox** (type=search, Clear) + status line "1 of 2 resumes match." (`fe/components/profiles/SearchBox.tsx`,
  `fe/lib/profileDashboard.ts:108-175`).
- **⋮ menu** (`useResumeActions`, `fe/components/profiles/useResumeActions.tsx:212-262`): Edit, Set as default, Duplicate, Move to another
  profile..., Keywords, Download JSON, Disable / Enable ("Kept, but left out of Build Resumes"), Delete (`window.confirm("Delete {label}?
  This can't be undone.")`). `ActionMenu` (`fe/components/resume/ActionMenu.tsx`) is an ARIA menu (arrows, Home/End, Escape, opens
  upward near the window foot).
- **Thumbnail fetching** (`ResumeCards.tsx:46-158`): `IntersectionObserver` (rootMargin 300px) then `POST /api/resumes/preview {resume: {},
  resumeId, sample: false}`; module-level LRU of 24 pages keyed `id:updatedAt`, in-flight requests shared; failure shows "No preview".

---

## 3. Data model

### 3.1 SQLite tables used by the flow (`be/database/sqlite.ts`)

```sql
-- be/database/sqlite.ts:59-68
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  owner_id TEXT, profile_id TEXT);
-- :70-77   (must NEVER gain a `disabled` column - glossaryRename.ts tells it from v4.1's resume table by that)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT);
-- :79-86   name/description/disabled overrides laid over a built-in template file
CREATE TABLE IF NOT EXISTS template_overrides (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- :88-95   admin-edited prompts (a built-in prompt is read from its file until edited)
CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, feature_key TEXT, is_built_in INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- :97-104  the shared skill library (seeded once from backend/static/skills/skills.json)
CREATE TABLE IF NOT EXISTS skills (type TEXT NOT NULL, skill_key TEXT NOT NULL, skill TEXT NOT NULL,
  priority INTEGER, category TEXT, PRIMARY KEY (type, skill_key));
-- :106-110 app settings (models, defaults...) as JSON values
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
```

Indexes created after columns (`sqlite.ts:1245-1256`): `idx_resumes_owner_profile ON resumes (owner_id, profile_id)`,
`idx_profiles_owner ON profiles (owner_id, created_at)`. `resumes.profile_id` is also in `ADDED_COLUMNS` (`:1049`) for upgraded DBs.

`DocumentTable<Resume>('resumes', r => ({ name, disabled: 0|1, owner_id: ownerId ?? '', profile_id: profileId ?? null }))`
(`be/database/resumeRepository.ts:40-46`): `data` = `JSON.stringify(resume)`; indexed columns rewritten on every save; `list()` orders
`updated_at DESC, id ASC` (`be/database/documentTable.ts:42-47`); `save` is an upsert (`INSERT ... ON CONFLICT(id) DO UPDATE`).

Saved (non-built-in) templates are NOT a table: files `backend/static/templates/<id>.json` with `"source": "uploaded" | "extracted" |
"manual"` (`be/database/templateFiles.ts`; CLAUDE.md:2039-2061). DB lives at `DB_DIR` (default `/data/db` POSIX,
`%LOCALAPPDATA%\free_tailor\db` Windows), file `free_tailor.db` (`sqlite.ts:22-41`).

### 3.2 The Resume document (`be/types/resume.ts`; frontend copy `fe/lib/api.ts:1654-2016`)

```ts
interface Resume {
  id: string;                 // uuid v4 (routes/resumes.ts uses uuid's v4); 'new' is reserved (chooser address)
  ownerId?: string;           // SERVER-owned (never read from a body)
  profileId?: string;         // SERVER-owned, mirrored to resumes.profile_id; moved only by POST /api/profiles/:id/move
  name: string;               // person's name printed on the resume; absent -> 'Untitled Profile'; '' stays ''
  title: string;              // headline; absent -> 'Professional'
  totalYearsExperience?: number;   // >= 0; "given to tailoring; not printed by itself"
  preferredTemplate?: string;      // template id ('' = none -> drawn with 'default')
  disabled?: boolean;              // default false ("left out of Build Resumes")
  resumeSettings?: ResumeSettings;
  contact: { phone: string; email: string; linkedin?: string; github?: string; portfolio?: string; location: string };
  summary: string;
  experience: Array<{ title; company; startDate; endDate; location; description: string; achievements: string[]; skills: string[] }>;
  strengths: Array<{ title: string; description: string }>;
  skills: string[];                              // canonical flat list (every grouped skill is also here)
  skillCategories?: Array<{ category: string; skills: string[] }>;  // author's own grouping; absent = "work it out"
  softSkills?: string[];                         // max 50 x 100 chars, case-insensitively unique
  education: Array<{ degree; institution; startDate; endDate; location: string; gpa?: string; achievements?: string[] }>;
  certifications?: Array<{ name; issuer; date: string; expiryDate?: string; credentialId?: string }>;
  projects?: Array<{ name; role; startDate; endDate; link; description: string; achievements: string[] }>;
  languages?: Array<{ language: string; proficiency: string }>;
  awards?: Array<{ title; issuer; date; description: string }>;
  publications?: Array<{ title; publisher; date; link; description: string }>;
  volunteering?: Array<{ role; organization; startDate; endDate; location; description: string; achievements: string[] }>;
  courses?: Array<{ name; institution; date: string }>;
  interests?: string[];                          // max 50 x 100
  references?: Array<{ name; title; company; email; phone: string }>;
  customSections?: Array<{ key: string /* [a-z0-9-]{1,40}, client-minted cs-xxxxxxxx */; title: string;
                           entries: Array<{ heading; subheading; startDate; endDate; location; description: string; achievements: string[] }> }>;
  sectionOrder?: string[];   // kind ids or 'custom:<key>'; ABSENT = template's own order (normaliser never fills it in)
  createdAt: string; updatedAt: string;   // ISO
}
interface ResumeSettings {
  resumePromptId?: string;               // default 'tailor-resume'           (TAILOR-only)
  resumeFileNameTemplate?: string;       // default '{{profile_name}}'        (TAILOR/generation-only)
  coverLetterFileNameTemplate?: string;  // default '{{profile_name}}_cover_letter' (TAILOR/generation-only)
  technicalSkillsLayout?: 'categorized' | 'flat';   // absent = categorized ("Grouped"/"Plain")
  includeSoftSkills?: boolean;           // absent = false
  includeStrengths?: boolean;            // absent = false
  ai?: { modelId?: string };             // resume's model for tailoring    (TAILOR-only)
}
```

Derived on read, never stored: `matchKeywords: { version, vocabulary, basedOn, headline: string[], roleTitles: string[], terms:
string[] }` on `GET /api/resumes` and `GET /api/resumes/:id` (`be/routes/resumes.ts:88-95`, `be/services/resumeKeywords.ts`).

**Normalisation rules** (`be/services/resumeDocument.ts:579-742`), applied on every create/update/import:

- Omitted field keeps the stored value; a list given replaces; `[]` clears (`normalizeEntryList`, `:401-413`).
- Strings trimmed (`toSafeString`); non-objects in lists dropped; an entry with nothing that names it dropped (projects: name|role|
  description|achievements; languages: language; awards: title|issuer; publications: title; volunteering: role|organization; courses:
  name; references: name; custom entries: heading|subheading|description|achievements); max 50 entries per list
  (`MAX_RESUME_SECTION_ENTRIES`), max 10 custom sections (`be/config/sectionCatalogue.ts:102-106`). Experience/education/strengths/
  certifications are NOT filtered for blankness server-side (the client drops blank rows).
- Custom section with a malformed or repeated key is dropped whole; one with a title and no entries is kept.
- Skills: `normalizeSkills` (`:689-721`) accepts 4 shapes (flat list, category map, list of groups, mix) and keeps the invariant
  that every grouped skill is in `skills`; naming only a flat `skills` CLEARS `skillCategories`.
- Settings: booleans decide only when boolean; layout only `categorized|flat`; file-name templates validated
  (`validateOutputFileNameTemplate`, `be/utils/outputStorage.ts:494-511`, throws PublicError on a bad token); `ai` through
  `normalizeAiPreferences` (only a non-empty `modelId` survives); legacy keys (`tailorMode`, `hardSkillOrdering`,
  `coverLetterPromptId`, `companyFolderNameTemplate`) dropped at next save.
- `sectionOrder`: cleaned to valid refs once each (custom refs only for keys just saved); omitted keeps stored (re-cleaned);
  `[]`/all-junk clears to absent (`:568-577`).
- `buildNewResume(data, id)` sets `createdAt = updatedAt = now`; `buildUpdatedResume` keeps id/createdAt, `updatedAt = now`
  (`:724-742`). Neither carries `profileId` or `ownerId` from the body.

### 3.3 Profiles (people) and placement (`be/database/profileTree.ts`, `be/services/profileRules.ts`)

```ts
interface Profile { id; ownerId?; name /* blank -> 'Untitled Profile' */; defaultResumeId?; createdAt; updatedAt }
interface ProfileSummary { id; name; ownerId? /* admin allOwners only */; createdAt; updatedAt;
  lastEditedAt /* later of profile.updatedAt and newest resume */; resumeCount; enabledResumeCount;
  defaultResumeId: string|null /* EFFECTIVE */; chosenDefaultResumeId: string|null /* stored */ }
```

- `placeNewResume(db, account, personName, requestedProfileId, {countLimit})` (`profileTree.ts:321-343`): (1) requested profile must be
  the caller's own (else 404 `profile-not-found`); (2) else the oldest profile whose `personKey` equals the resume name's
  (`personKey` = NFC, trim, collapse whitespace, cut to 100 chars, lower-case; blank = 'untitled profile'; `profileRules.ts:39-53`);
  (3) else a new profile named `profileNameForPerson(name)`; only (3) calls `assertCanAddProfile` (402 `profile-limit`,
  `be/database/profileLimit.ts:94-102`; tier caps Default 1 / Premium 5 / Premium+ 25 / Premium Max unlimited; admins exempt).
- The first resume in becomes the profile's default (`adoptAsDefaultIfNone`, `:235-247`); delete/move re-points it
  (`repointDefaultAfterLeaving`, `:255-265`). Defaults matter only to the Fully Tailor run mode.
- Every tree write is ONE IMMEDIATE better-sqlite3 transaction on ONE connection (`inTreeTransaction`, `:85-88`).
- Lazy filing of pre-v4.2 unfiled resumes runs on every profiles route and resume GET (`fileUnfiledResumes`, `:410-457`) - a
  migration concern TailorIT does not have (fresh DB).
- The Bid Assistant's `answers` table is deleted with a resume/profile (`deleteAnswersFor`, `:291-300`) - TailorIT can drop it.

### 3.4 Section catalogue (15 kinds + custom)

Server: `be/config/sectionCatalogue.ts` (265 lines). Client mirror + UI half: `fe/lib/sectionCatalogue.ts:138-461`.
`DEFAULT_SECTION_KINDS` = the classic six + certifications (cards always shown, no Remove section; `fe/lib/sectionCatalogue.ts:484`).

| id | printed heading | card label | shape / editor | bullets | classic | Edit Entry fields (name: label, placeholder) | AI kind |
|---|---|---|---|---|---|---|---|
| summary | Professional Summary | Summary | text / summary | - | yes | (textarea in card) | - |
| strengths | Key Strengths | Strengths | entries | no | yes | title "Title" (e.g. Customer-centric), description (textarea) | - |
| skills | Technical Skills | Technical skills | inline / skills | - | yes | (chips + heading select) | - |
| softSkills | Soft Skills | Soft skills | inline / softSkills | - | yes | (chips) | - |
| experience | Professional Experience | Experience | entries | yes | yes | title "Job title", company "Company", startDate "Start date" (MM/YYYY), endDate "End date" (MM/YYYY or Present), location "Location" (City, country or Remote), description (textarea) + "Skills used" | experience |
| education | Education | Education | entries | no | yes | degree "Degree", institution "Institution", startDate, endDate, location | - |
| certifications | Certifications | Certifications | entries | no | no (default card) | name "Certification", issuer "Issuer", date "Date" | - |
| projects | Projects | Projects | entries | yes | no | name "Project name", role "Your role", startDate, endDate, link "Link" (url), description | project |
| volunteering | Volunteering | Volunteering | entries | yes | no | role "Role", organization "Organisation", startDate, endDate, location, description | volunteering |
| awards | Awards | Awards | entries | no | no | title "Award", issuer "Given by", date, description | - |
| publications | Publications | Publications | entries | no | no | title "Title", publisher "Published in", date, link, description | - |
| courses | Courses | Courses | entries | no | no | name "Course", institution "Institution", date | - |
| languages | Languages | Languages | inline / entries | no | no | language "Language", proficiency "Proficiency" | - |
| interests | Interests | Interests | inline / chips | - | no | (chips) | - |
| references | References | References | entries | no | no | name "Name", title "Their title", company "Company", email (email), phone (tel) | - |
| custom:<key> | {title} | {title} or "Custom section" | entries | yes | - | heading "Heading", subheading "Subheading", startDate, endDate, location, description | - |

Order semantics (`effectiveSectionOrder`, `fe/lib/sectionCatalogue.ts:674-701`; same in `be/config/sectionCatalogue.ts:238`): with
no stored order -> the template's `nativeSectionOrder` filtered to default+present kinds, then remaining default/present kinds in
canonical order, then custom sections; with a stored order -> stored refs, then unlisted defaults (template order), then unlisted
present kinds, then unlisted custom sections. The PDF reorders sections only WITHIN the parent element (column) the template put them in.

### 3.5 Templates

`Template` (`be/types/template.ts:33-79`; client `fe/lib/api.ts:2064-2098`):
`{ id, name, description, disabled?, category?: 'simple'|'modern'|'creative', source?: 'uploaded'|'extracted'|'manual', htmlContent,
cssContent, sections: string[], createdAt, updatedAt, manualConfig?, isBuiltIn?, supportsSoftSkills, supportsStrengths,
printsSections: string[], nativeSectionOrder: string[] }`. The last four are DERIVED from the markup on every read
(`normalizeTemplateRecord`, `be/extractors/templateExtractor.ts:82-134`, via `be/services/templateImport.ts:118-204`).

- Built-ins = files in `backend/static/templates` WITHOUT `source` (read on every request, never copied; admin overrides of
  name/description/disabled in `template_overrides`). 19 built-ins with categories: simple (burgundy-rule, classic-serif,
  dossier-panel, framed-serif, ink-ledger, navy-gold, navy-rule, structured-slate), modern (azure-stack, charcoal-sidebar,
  contrast-cards, `default` "Professional Two-Column", forest-chips, indigo-band), creative (amber-gradient, developer-mono,
  editorial-italic, slate-italic, timeline-bars). Plus 7 committed saved files with `source: "uploaded"` and no category
  (`9145ec7c-...` "Classic Strict", ats-classic-serif, ats-education-first, ats-executive, ats-modern-sans, ats-tech-compact,
  sidebar-executive) - they appear only under All Templates.
- Markup = a complete HTML document with an `@page` rule, Handlebars fields (`{{name}}`, `{{title}}`, `{{contact.email}}`,
  `{{#each experience}}...{{#each achievements}}<li>{{this}}</li>`, `{{#if strengths.length}}`, `{{#each hardSkills}}`...), section
  wrappers carrying marker classes `section-<kind>` (`section-summary`, `section-experience`, `section-strengths`, `section-skills`,
  `section-soft-skills`, `section-education`), and ONE macro line `{{> extra-sections sectionClass=... headingClass=... entryClass=...
  titleClass=... subClass=... datesClass=... bulletsClass=...}}` where the nine extra kinds + custom sections print (example:
  `backend/static/templates/default.json`). Helpers: `join`, `formatDate` (identity) (`be/generators/pdfGenerator.ts:640-647`).
- Template choice for a resume (`resolveTemplateForResume`, `be/services/templateChoice.ts:37-56`): requested id, else
  `preferredTemplate`, else `default` - first that exists and is enabled - else the first enabled template (newest first), else null
  -> 503 "No resume template is available right now. Please contact your administrator.". Client mirror `drawnTemplate`
  (`fe/lib/resumeDraft.ts:1064-1071`).

### 3.6 The editor's form model (`ResumeDraft`, `fe/lib/resumeDraft.ts:126-166`)

Same fields as `Resume`, with: every list row carrying `key` (`row-N`); bullet kinds holding `achievementsText` (one line per bullet)
instead of `achievements[]`; `totalYearsExperience` as text; `skillCategoryBySkill: Record<skill, heading>` instead of groups;
`sectionOrder: string[] | null` (null = follow template); `settings: Required<ResumeSettings>` with defaults
`DEFAULT_RESUME_SETTINGS` (`:171-183`). Conversions: `draftFromResume` (`:308-363`), `draftForNewResume` (`:371-378`),
`draftToPayload` (save, `:761-781`), `draftToPreviewResume` (only the three render settings, `:791-801`). Education/certification rows
are spread so unedited fields (gpa, expiryDate, credentialId) survive a save.

---

## 4. API contract (every call the flow makes)

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:3001/api`, `fe/lib/api.ts:20-21`). Auth: session token as
`Authorization: Bearer <token>` (from `localStorage['adminToken']`, `fe/lib/api.ts:91`) AND httpOnly cookie `ft_session`
(`be/middleware/auth.ts:33-67`); `credentials: 'include'`. All routes below are `requireUser` (401 `{error: 'Sign in to do that.',
code: 'not-signed-in'}`; reporter role 403 `role-not-allowed`). Errors are `{ error, code?, ref?, detail? /* admins only */, ...extra }`
(`be/middleware/publicError.ts`). JSON body limit `JSON_BODY_MAX_MB` (default 10).

### 4.1 Resumes (`be/routes/resumes.ts`, client `resumesApi` `fe/lib/api.ts:2315-2404`)

| Method & path | Request | Response | Errors / notes | Source |
|---|---|---|---|---|
| GET `/api/resumes` | `?includeDisabled=true`, `?allOwners=true` (admin) | 200 `Resume[]` each + `matchKeywords` | files viewer's unfiled resumes first | resumes.ts:98-109 |
| GET `/api/resumes/:id` | - | 200 `Resume` + `matchKeywords` | 404 `{error:'Resume not found'}` (also for others' resumes) | :112-126 |
| POST `/api/resumes` | `?profileId=<own profile>` optional; body `CreateResumeDTO` (profileId/ownerId in body ignored) | 201 `Resume` (with `profileId`) | 404 `profile-not-found`; 400 `bad-profile-id`; 402 `profile-limit` + `limit`; 409 `resume-id-taken`; 400 `ModelUnavailableError` (model choice); 400 bad file-name template | :136-152 |
| PUT `/api/resumes/:id` | body `Partial<CreateResumeDTO>` (omitted = keep) | 200 `Resume` | 404; row re-read inside the transaction (no upsert) | :155-178 |
| DELETE `/api/resumes/:id` | - | 200 `{message:'Resume deleted successfully'}` | 404 | :181-189 |
| POST `/api/resumes/preview` | `{ resume: CreateResumeDTO-ish draft, resumeId?, templateId?, sample?: false }` | 200 `{ html, templateId, page: { widthPx, heightPx, contentHeightPx }, sampled: string[] }` | 404 resume/template; 503 no template. Saves nothing, no AI, no limit check | :221-268 |
| POST `/api/resumes/import` | `?profileId=`; body = JSON document (one resume, array, or `{resumes:[...]}`) | 201 `{ resumes, imported, keptIds, profileIds, createdProfiles:[{id,name}] }` | 400 ResumeImportError sentences; 402; 404 | :291-325 |
| POST `/api/resumes/upload` | `?profileId=`; multipart `resume` (PDF) | 201 `Resume` | 415 `upload-not-pdf`; 413 `upload-too-large` + `limitMb`; 400 unreadable PDF; AI public sentences; 402; 404 | :336-369 |
| POST `/api/resumes/entries/bullets` | `{ kind: 'experience'|'project'|'volunteering', entry, resume?: {name,title,totalYearsExperience?,summary,skills}, task: 'write'|'improve', instructions? }` | 200 `{ bullets: string[] }` (1-8, ≤300 chars) | 400 `bad-kind`/`bad-task`/`entry-incomplete`/`nothing-to-improve`; 409 `already-running`; 503 AI unavailable | :386-402 |

Preview body details (`buildPreviewResume`, `be/services/resumeDocument.ts:779-843`): never throws; lays the draft over the stored
resume (`resumeId`) with the omitted-keeps-stored rule; takes only `technicalSkillsLayout`, `includeSoftSkills`, `includeStrengths`
from `resumeSettings`. `sampled` keys from `SAMPLE_FIELDS` = `name, title, email, phone, location, linkedin, summary, experience,
education, skills, strengths, softSkills` (`be/services/sampleResume.ts:262-275`); `sample:false` -> no sample, `sampled: []`.

### 4.2 Templates (`be/routes/templates.ts`, client `templatesApi` `fe/lib/api.ts:2565-2655`)

| Method & path | Request | Response | Source |
|---|---|---|---|
| GET `/api/templates` | `?includeDisabled=true` (admin only) | 200 `Template[]` (enabled), newest `updatedAt` first, FULL htmlContent/cssContent | templates.ts:75-95 |
| GET `/api/templates/:id/preview` | `?layout=flat|categorized&softSkills=1&strengths=1` | 200 `text/html` + header `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`; sample person TAILORED (`SAMPLE_RESUME` + `SAMPLE_TAILORED_CONTENT`) | :115-134 |
| GET `/api/templates/:id` | - | 200 `Template` / 404 | :137-148 |
| (admin) POST `/create-manual`, `/upload-json`, `/upload` (PDF -> AI-extracted template), PUT `/:id/update-manual`, PATCH `/:id`, DELETE `/:id` | - | - | :150-345 (not part of the new-resume flow) |

### 4.3 Profiles (`be/routes/profiles.ts`, client `profilesApi` `fe/lib/api.ts:2515-2562`)

| Method & path | Request | Response |
|---|---|---|
| GET `/api/profiles` | `?allOwners=true` (admin) | 200 `ProfileSummary[]` newest edit first |
| GET `/api/profiles/:id` | - | 200 `ProfileSummary` / 404 `profile-not-found` |
| POST `/api/profiles` | `{ name?, resumeIds? }` ONLY (other keys -> 400 `stale-page`) | 201 `ProfileSummary`; 402 `profile-limit`; 400 `profile-name-required`/`profile-name-too-long` (100) |
| PUT `/api/profiles/:id` | `{ name?, defaultResumeId? }` | 200 `ProfileSummary`; 400 `use-move`/`nothing-to-change`/`default-not-member`; 409 `default-disabled` |
| POST `/api/profiles/:id/move` | `{ resumeIds }` | 200 `{ moved, profiles: ProfileSummary[] }` |
| DELETE `/api/profiles/:id` | - | 200 `{ deleted: true, deletedResumes }` (deletes every resume in it) |

Full refusal table: CLAUDE.md:2333-2349.

### 4.4 Editor helpers on the builder's router (`be/routes/resume.ts`, client `resumeApi` `fe/lib/api.ts:2864-2917`)

| Method & path | Request | Response | Used by |
|---|---|---|---|
| GET `/api/resume/models` | - | 200 `UserAppSettings` `{ defaultMode, defaultTheme, defaultBuildMode, defaultProfileId, defaultModelId, defaultResumeDocxEnabled, defaultCoverLetterDocxEnabled, models: [{id,name}], outputPathUsesJobTitle, suitablePriceMilli, partialPriceMilli, fullPriceMilli }` | GenerationSettingsCard, savableModelChoice, Duplicate (resume.ts:117-124) |
| GET `/api/resume/skills?type=hard|soft` | - | 200 `{ skills: string[] }` (1,492 hard / 1,247 soft seeded) | datalist (controllers/skills.ts:47-58) |
| POST `/api/resume/skills/confirm` | `{ type, skill }` | 200 `{ added, skill, type }` - adds to the SHARED library, category inferred | adding a skill unknown to the library (controllers/skills.ts:62-74) |
| GET `/api/prompts` | - | 200 `PromptSummary[]` | Building prompt select (routes/prompts.ts:48) |
| GET `/api/auth/me` | - | 200 `{ account: Account|null, uploadMaxMb }` | AuthContext (upload cap, profile counts) (routes/auth.ts:195-200) |

---

## 5. Rendering pipeline

### 5.1 Live preview (draft -> HTML), all synchronous Node, no browser

```
client draftToPreviewResume(draft)                                         fe/lib/resumeDraft.ts:791-801
 -> POST /api/resumes/preview {resume, resumeId?}                          be/routes/resumes.ts:221-268
   -> buildPreviewResume(body.resume, existing)                            be/services/resumeDocument.ts:779-843
   -> resolveTemplateForResume(draft, templateId?)                         be/services/templateChoice.ts:37-56
   -> resumeForTemplate(draft, template)   (switch on + no section in markup => off)   resumeDocument.ts:253-271
   -> withSampleDefaults(fitted)  (unless sample:false)                    be/services/sampleResume.ts:340-394
   -> generateResumeDraftPreviewHTML(shown, template)                      be/generators/pdfGenerator.ts:1988-2001
        prepareResumeRenderData(resume)  (untailored branch)               pdfGenerator.ts:1538-1600
          = {...resume, ...prepareExtraSectionData (dates joined, http(s) links),          services/extraSections.ts:94
             contact (linkedinHref/linkedinDisplay, safe github/portfolio), title = sanitizeTitleForATS(...)}
          -> applySkillsLimit  THE RENDER GATE: Technical Skills lines (author grouping, else library grouping
             in HARD_SKILL_CATEGORIES order, library-known skills only; Plain = one headless list), empties
             softSkills/strengths when their switch is off                 pdfGenerator.ts:991-1037
        renderTemplateBody: compileTemplate(template, choices) (LRU 128 keyed by layout|soft|strengths|order|customKeys|markup)
          -> compilableMarkup -> normalizeTemplateSkillsSections:          pdfGenerator.ts:1335-1356
               1 expandExtraSectionsMacro (one guarded block per extra kind + per custom section)   generators/extraSectionsMarkup.ts:156-169
               2 strip (switch off) / guard (switch on) Strengths & Soft Skills sections (findOptionalSections)
               3 reorderTemplateSections when a sectionOrder is stored (within each parent column)  pdfGenerator.ts:1379
               4 'Hard Skills' -> 'Technical Skills'
               5 Grouped: rewritePerItemSkillLoops | Plain: fitPlainSkillGroups (data-plain-skills + style)   generators/plainSkillsMarkup.ts:101
               6 injectExtraSectionsStyle (<style id="xs-style">), guardEmptyCategoryHeadings, guardEmptyDescriptions
             (falls back to 'marked' finds, then 'none', if the cut markup no longer parses; warned once)
          -> Handlebars(renderData) -> rewriteLinkedInAnchorDisplay -> enforceSkillCategoryLineBreaks
        assembleResumeDocument: <style>{cssContent}</style> + body
        withPreviewContentSecurityPolicy: <meta http-equiv="Content-Security-Policy" ...> right after the doctype
        + previewPageChrome(resolveTemplatePageBox(template)): <style id="resume-preview-page"> html width = page,
          padding = template @page margins, clip-path, body width = content box (scale-to-A4 for Letter etc.)
   <- { html, templateId, page: { widthPx: 794, heightPx: 1123 (A4), contentHeightPx }, sampled }
client: iframe srcDoc sandbox="allow-same-origin" (no scripts), width=page.widthPx, scaled by transform    ResumeDraftPreview.tsx:246-272
```

### 5.2 PDF (only inside a generation run today)

`generateResumePDF(resume, template, tailoredContent, pathInfo, companyName?, role?)` (`be/generators/pdfGenerator.ts:1702-1776`):
same render data + compile, no CSP/preview chrome; shared headless Chrome (`getSharedPdfBrowser`, `:440-466`; launched by
`launchBrowser`, `be/config/browser.ts:401-425`, args `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`,
executable from `PUPPEETER_EXECUTABLE_PATH`/`CHROME_PATH`, puppeteer's download, or an installed Chrome/Edge/Chromium/Brave);
viewport = template content box; `emulateMediaType('print')`; `setContent(html, {waitUntil:'load'})`; `page.pdf({ format: 'A4',
margin: RESUME_PAGE_GEOMETRY.margin, printBackground: true })` (template `@page` margins win); timeout `PDF_RENDER_TIMEOUT_MS`
(30 s default); WRITES the file under the run's output folder (`getResumeOutputFilename(pathInfo, 'pdf')`) and returns the relative
path. JavaScript is NOT disabled in that page and no request interception is set (Risk R9).

### 5.3 DOCX

`generateResumeDOCX(...)` (`be/generators/docxGenerator.ts:382-413`): `buildResumeDocxHTML(renderData)` = ONE fixed look regardless of
template (Arial 9pt, centred header, accent `#2B5C8A`, underlined section headings) in `effectiveSectionOrder`, converted by
`html-to-docx` (`margins 720 twips`, portrait), written to the run folder. The template only decides which optional sections exist.

### 5.4 Thumbnails

- Template gallery: `PageThumb src={apiOrigin}/api/templates/<id>/preview?layout=` (`fe/components/resume/PageThumb.tsx:28-77`):
  iframe 794x1123 scaled to the box width (`ResizeObserver`), keyed by `src` (a new src = a new frame, to avoid history entries),
  `loading="lazy"`; box `aspect-ratio: 794 / 1123` (`resumePages.module.css:71-86`). Rendered with the sample person through the
  TAILORED branch (`generateTemplatePreviewHTML`, `pdfGenerator.ts:1919-1934`).
- Resume cards: `PageThumb srcDoc={html}` with `sandbox=""` (every flag off) from `POST /api/resumes/preview {resume:{}, resumeId,
  sample:false}` (section 2.10). Only the first page shows (overflow hidden).
- No raster images are generated anywhere; every thumbnail is a live document.

### 5.5 Proposed TailorIT export (does not exist in free_tailor)

INFERRED design: `GET /api/resumes/:id/export?format=pdf|docx` = `getResumeFor` -> `resolveTemplateForResume` -> `resumeForTemplate`
-> `prepareResumeRenderData` -> compile -> Puppeteer `page.pdf()` into a Buffer (not a file) / `HTMLtoDOCX` Buffer, streamed with
`Content-Disposition`. This needs `generateResumePDF` refactored to return a buffer and to drop `GeneratedPathInfo`/`utils/generatedPath`
(which drags `config/aiModelConfig`).

---

## 6. "Tailor" vs "new resume": the cut line

### 6.1 Classification

| Area | NEW RESUME (port) | TAILOR (leave out) | SHARED (port, but split/strip) |
|---|---|---|---|
| Pages | `fe/app/admin/resumes/new/page.tsx`, `fe/app/admin/resumes/[id]/page.tsx`, list parts of `fe/app/admin/profiles/*` | `fe/app/page.tsx` (Build Resumes), `fe/app/jobs/*` order flows, `fe/app/orders/*` | `fe/app/admin/layout.tsx` (desk route switch) |
| Frontend components | `fe/components/resume/*` except below | `fe/components/ResumePreview.tsx` (builder modal: "Resume Preview", "ATS OPTIMIZATION" pill, "Generate Resume"; used only by `fe/app/page.tsx:39`), `fe/components/builder/*`, `ImmediateRunFiles`, `SheetsSourcePanel` | `GenerationSettingsCard.tsx` (model / Building prompt / file names are tailoring settings), `KeywordsCard`/`KeywordChips` (matcher keywords), `AiPreferenceFields.tsx` (shared with the builder) |
| Frontend libs | `resumeDraft`, `sectionCatalogue`, `previewPane`, `resumeGallery`, `upload`, `profileDashboard` (subset), `useMediaQuery`, `useDismissable`, `dialogStack`, `userMessage` | `tailoredDraft`, `runChoices`, `buildModes`, `generationQueue`, `immediateRun`, `batchFollow`, `orders`, `jobAnalysis` | `api.ts` (2,934 lines, imports `buildModes`, `providerDisplay`, `settingSources` at runtime - split it), `resumeModelChoice` (only if model choice is kept) |
| Copy strings | - | - | `fe/lib/sectionCatalogue.ts` descriptions that talk about tailoring (Summary: "Partial tailor rewrites it for each job..."; Experience: "...tailoring writes each role's bullets for the job..."; Technical skills: "...A tailored resume prints the skill groups written for each job..."), SkillCards/Strengths switch sentences, Layout radio descriptions, `bulletCountNote` ("A tailored resume prints at most 8"), sample notice ("...or sent to tailoring") - rewrite for TailorIT |
| Backend routes | `routes/resumes.ts`, `routes/profiles.ts`, `routes/templates.ts` (GET /, /:id, /:id/preview) | `routes/generation.ts`, `routes/orders.ts`, `routes/resume.ts` POST `/analyze`, `/preview` | `routes/resume.ts` (GET `/models`, `/skills`, POST `/skills/confirm` live beside the builder routes), `routes/prompts.ts` (only GET `/` for the Building prompt) |
| Backend services | `resumeDocument`, `resumeImport`, `sampleResume` (`SAMPLE_RESUME`, `withSampleDefaults`), `extraSections`, `templateChoice`, `templateImport` (capabilities), `entryBullets`, `profileRules` | `resumeService` (tailorResume, parse, cover letter), `tailorContract`, `reviseCoverage`, `tailorCache`, `resumeChoice`, `resumeMatch`, `queue/*`, `jobAnalysis/*`, `outputPath`, `credits`, `subscriptions` | `resumeService.extractResumeFromText` (`:1158-1186`) and `resumeService.cleanBullets` (`:447-454`, pulls `sanitizeResumeText`/`stripUnsafeResumeSentences`/`isUnsafeJobPostingPhrase`/`stripBoldTags`/`normalizeSkillsList` from resumeService and `dashBackstop`/`isCompanyDescriptionLike` from `tailorContract.ts:624`), `skillGroups` (render gate reads tailored `skillGroups`), `sampleResume.SAMPLE_TAILORED_CONTENT` (gallery preview), `resumeKeywords` (matchKeywords on GETs; possibly reusable for TailorIT's job-match analysis) |
| Generators | `sectionLocator`, `extraSectionsMarkup`, `plainSkillsMarkup` | `coverLetterGenerator` | `pdfGenerator` (one render gate with an optional `tailoredContent` branch; `generateResumePDF` writes to run paths), `docxGenerator` (same) |
| Extractors | - | `extractAndSaveTemplate` (admin PDF->template AI) | `templateExtractor.getAllTemplates`/`getTemplateById` (same file imports `extractTemplateFromPDF` from resumeService and `pdf-parse`) |
| Config | `sectionCatalogue`, `templateCategories`, `staticPaths`, `browser`, `operational` (subset) | `buildModes`, `accountSubscriptions`, `jobFields`, `industries`, `conceptTools` | `aiPreferences` (only `normalizeAiPreferences` needed; file imports `aiModelConfig`), `aiModelConfig` (`checkResumeModelChoice`, `resolveRequestedAIModel`, `getUserAppSettings` - 2,688 lines) |
| Database | `documentTable`, `resumeRepository`, `profileTree`, `profileRepository`, `skillsDatabase`, `templateFiles`, `templateRepository` | `orderRepository`, `generationRepository`, `creditRepository`, `jobAnalysisRepository`, `tailorCacheRepository`, `jobLakeRepository` | `profileLimit` (subscription tiers), `sqlite.ts` (schema has every table; upgrade guard, glossary rename, migrations are free_tailor history) |
| Resume fields | content fields, `preferredTemplate`, `technicalSkillsLayout`, `includeSoftSkills`, `includeStrengths`, `sectionOrder`, `customSections` | `resumeSettings.resumePromptId`, `resumeSettings.ai`, `resumeFileNameTemplate`, `coverLetterFileNameTemplate`, `Profile.defaultResumeId`, `matchKeywords`, `disabled` (means "left out of Build Resumes") | `totalYearsExperience` (form field, used only by tailoring and Write with AI) |
| AI | prompts `extract-profile-from-resume`, `write-entry-bullets` | `tailor-resume`, `tailor-resume-full`, `revise-resume-coverage`, `generate-cover-letter`, `analyze-job-description`, `filter-google-sheet-job` | `services/ai/*` (transport, CLI seats), `services/promptService.ts` (1,806 lines; prompt files + admin edits) |

### 6.2 Concrete couplings to cut (with the symbol and line)

1. `be/routes/resumes.ts:10` imports `extractResumeFromText` from `../services/resumeService` -> move `buildExtractResumePromptValues`
   + `extractResumeFromText` (`resumeService.ts:1158-1186`) into a new `services/resumeExtraction.ts`.
2. `be/services/entryBullets.ts:6` imports `cleanBullets` from `./resumeService` -> move `cleanBullets` + its 5 helpers + `dashBackstop`
   into `services/bulletHygiene.ts` (keep the JOB_POSTING_* / RESUME_META_TAILORING patterns, `resumeService.ts:100-120`).
3. `be/routes/resumes.ts:21` and `be/services/templateChoice.ts:4` import from `extractors/templateExtractor.ts`, whose line 4 imports
   `extractTemplateFromPDF` from resumeService -> split a read-only `templateStore.ts` (`normalizeTemplateRecord`,
   `applyTemplateOverride`, `readStaticTemplate`, `listStaticTemplates`, `getAllTemplates`, `getTemplateById`; lines 82-254).
4. `be/services/resumeDocument.ts:1` imports `normalizeAiPreferences` from `config/aiPreferences.ts`, which imports `aiModelConfig`
   -> inline the 10-line normaliser (or drop `ai` from `ResumeSettings`).
5. `be/services/resumeDocument.ts:32-36` imports `validateOutputFileNameTemplate` from `utils/outputStorage.ts` (generation output
   paths) -> drop the two file-name settings from TailorIT's resume, or port only the validator.
6. `be/routes/resumes.ts:8,57-65` `checkResumeModelChoice` (aiModelConfig) -> drop with the model choice.
7. `be/services/entryBullets.ts:1,234` `resolveRequestedAIModel` (aiModelConfig) -> TailorIT's own model resolver.
8. `be/generators/pdfGenerator.ts:36-37` imports `GeneratedPathInfo`/`getResumeOutputFilename` from `utils/generatedPath.ts`
   (which imports `config/aiModelConfig` and `config/settingDefaults`) -> refactor `generateResumePDF` to return a Buffer.
9. `be/generators/pdfGenerator.ts:38-44` reads the skill library (`readHardSkillIndex`) for Grouped layout auto-grouping -> keep
   `skillsDatabase.ts` + `static/skills/skills.json` (the render depends on them).
10. `be/database/profileTree.ts:15` `assertCanAddProfile` (subscriptions) and `deleteAnswersFor` (Bid Assistant) -> simplify per Q1.
11. `be/middleware/auth.ts` `requireUser` needs `userRepository`/sessions (`resolveSession`) - comes with TailorIT's auth port
    (ft-auth report).

---

## 7. Files to port, with dependency chains

### 7.1 Frontend (measured runtime import closure)

Closure of `fe/app/admin/resumes/new/page.tsx` + `fe/app/admin/resumes/[id]/page.tsx` (walker script, runtime imports only): **55 files**.
Closure of the two profile pages (list/thumbnail views): **43 files** (mostly overlapping). Packages: `react`, `react-dom`, `next/link`,
`next/navigation`, `next/font/google` (DM Sans). No UI library; icons are hand-rolled SVG (`fe/components/icons/index.tsx`, 597 lines).

| File | Lines | Role | Port note |
|---|---|---|---|
| `fe/app/admin/resumes/new/page.tsx` | 213 | chooser vs new editor, import notices | move to TailorIT route, e.g. `/documents/resumes/new` |
| `fe/app/admin/resumes/[id]/page.tsx` | 69 | loads resume, mounts editor | |
| `fe/components/resume/ResumeEditor.tsx` | 944 | draft owner, bar, tabs, cards, save | change post-save destination; drop Customize cards per Q3 |
| `fe/components/resume/EditorHeaderCard.tsx` | 77 | name/title/contact card | |
| `fe/components/resume/ContentCards.tsx` | 218 | SummaryCard, InterestsCard, BasicsPanel | |
| `fe/components/resume/SkillCards.tsx` | 228 | TechnicalSkillsCard, SoftSkillsCard | imports `fe/components/admin/resumeTemplateChrome.module.css` (`.chipSelect`) |
| `fe/components/resume/EntrySection.tsx` | 135 | entry-list card | |
| `fe/components/resume/EntryEditor.tsx` | 349 | Edit Entry panel + Write with AI | |
| `fe/components/resume/SectionCard.tsx` | 148 | collapsible card | |
| `fe/components/resume/SectionSlot.tsx` | 109 | drag & drop wrapper | |
| `fe/components/resume/AddContentDialog.tsx` | 123 | "Add content" | |
| `fe/components/resume/parts.tsx` | 316 | ChipList, AddInput, SectionSwitch, AddRowButton, KeptLine, SwitchCapabilityNote, NotPrintedNote, EditorPanel, SettingsCard, DoneButton, `UpdateDraft` type | |
| `fe/components/resume/TemplateCard.tsx` | 174 | Template + Layout cards | |
| `fe/components/resume/GenerationSettingsCard.tsx` | 148 | tailoring settings | likely DROP (Q3) |
| `fe/components/resume/ResumeDraftPreview.tsx` | 428 | live preview + Full size viewer | imports `resumeTemplateChrome.module.css` (`.viewerBar`) |
| `fe/components/resume/TemplateChooser.tsx` | 377 | gallery + details dialog | |
| `fe/components/resume/ImportStartDialog.tsx` | 106 | "Import your existing resume" | |
| `fe/components/resume/useResumeImport.ts` | 125 | PDF/JSON import hook, `chooseFile` | |
| `fe/components/resume/useWriteBullets.ts` | 72 | AI bullets state machine | |
| `fe/components/resume/PageThumb.tsx` | 87 | scaled A4 iframe | |
| `fe/components/resume/ActionMenu.tsx` | 180 | ⋮ / Import menus | uses `fe/lib/useDismissable.ts` |
| `fe/components/resume/ResumeCards.tsx` | 337 | ResumeCard (grid), ResumeRow (list), ResumeThumb + cache, NewResumeTile, saveTextFile | for Documents -> Resumes |
| `fe/components/resume/editorFont.ts` | 17 | DM Sans `--font-editor` | swap for Simplify's type (Q4) |
| `fe/components/resume/resumeEditor.module.css` | 1,804 | editor look + `--ed-*` tokens (light + `html.dark`) | re-theme |
| `fe/components/resume/resumePages.module.css` | 868 | chooser, cards, ⋮ menu, dashed tiles, import dialog | re-theme |
| `fe/components/profiles/profiles.module.css` | 655 | list rows, view toggle, search, badges, dialogs, keyword chips | needed for list view |
| `fe/components/profiles/ViewToggle.tsx`, `SearchBox.tsx` | 67, 56 | Grid/List toggle, search | |
| `fe/components/profiles/useResumeActions.tsx` | 288 | ⋮ items + Move/Keywords dialogs | trim (Move, Set as default, Keywords are profile/tailor features) |
| `fe/components/profiles/ProfileCards.tsx`, `ProfileDialogs.tsx` | 183, 596 | profile cards, New resume / Move / Keywords dialogs | only if profiles are kept (Q1) |
| `fe/components/profiles/KeywordsCard.tsx`, `KeywordChips.tsx` | 23, 66 | matcher keywords | optional |
| `fe/components/profiles/flashNotice.ts`, `focusAfterRemoval.ts` | 44, 53 | sessionStorage notice, focus after delete | |
| `fe/components/admin/resumeTemplateChrome.module.css` | 240 | only `.chipSelect` (`:87-95`) and `.viewerBar` (`:129-138`) used here | copy the two rules |
| `fe/components/AiPreferenceFields.tsx` | 128 | model select | drop with GenerationSettingsCard |
| `fe/components/ui/kit.tsx` | 369 | Field, Notice, ErrorNotice, Pill, Spinner... | imports `ContactAdminLink` (`fe/components/contact/ContactAdminDialog.tsx`) -> `fe/lib/contact.ts`, `fe/lib/contactChannels.ts`, `fe/lib/appLinks.ts` (likely covered by ft-frontend-system) |
| `fe/components/ui/Dialog.tsx` | 181 | the modal + `useDialogLayer` | uses `fe/lib/dialogStack.ts` |
| `fe/components/subscription/LockedFeature.tsx` (+ `subscription.module.css`) | 199 | only `ProfileLimitLink` used here | drop if no subscriptions |
| `fe/contexts/AuthContext.tsx` | 193 | `refresh`, `uploadMaxMb`, `refreshUploadMaxMb`, `account` | from the auth port |
| `fe/lib/resumeDraft.ts` | 1,072 | pure draft logic (type-only imports) | port as is |
| `fe/lib/sectionCatalogue.ts` | 759 | catalogue mirror + UI specs + order helpers | keep in sync with backend copy (or share a package) |
| `fe/lib/previewPane.ts` | 81 | stable pane width | |
| `fe/lib/resumeGallery.ts` | 207 | filters, links, `readStartChoice`, `editedAgo`, duplicate/export bodies | |
| `fe/lib/profileDashboard.ts` | 184 | view mode, hrefs, `resumeLabel`, search helpers | |
| `fe/lib/upload.ts` | 79 | PDF size checks | |
| `fe/lib/resumeModelChoice.ts` | 30 | savable model choice | drop with model choice |
| `fe/lib/useMediaQuery.ts`, `useDismissable.ts`, `dialogStack.ts`, `userMessage.ts`, `format.ts` | 47, 47, 72, 144, 258 | hooks / messages / dates | |
| `fe/lib/api.ts` | 2,934 | apiFetch + types + clients | port only: base/token/`apiFetch`/`ApiResponseError`/`ApiUnreachableError`, resume/profile/template types, `resumesApi`, `profilesApi`, `templatesApi.getAll`, `resumeApi.listSkills/confirmSkill`, `HARD_SKILL_CATEGORIES` (`:1835-1853`), `readResumeImportFile`, `getApiOrigin` |
| `fe/components/icons/index.tsx` | 597 | inline SVG icons + `ICONS` map | icons used: Document, Palette, Grid, Plus, Pencil, Mail, Phone, MapPin, Link, Trash, Sparkle, ChevronRight, Grip, ArrowUp/Down, Check, Close, Upload, Expand, Templates, MoreVertical, Star, Copy, Download, Eye/EyeOff, Folder, Text, List, Search, Lock + ICONS names in catalogue (text, shield, wrench, people, briefcase, graduation, certificate, folder, heart, trophy, bookOpen, book, language, star, accounts, list) |
| `fe/app/admin/layout.tsx` | 31 | bare `<main className="tl-fill">` for desk routes | adapt to TailorIT routes |

### 7.2 globals.css classes and tokens these files rely on (`fe/app/globals.css`, 1,875 lines)

Classes used in className strings (count across the files above): `tl-input` 22, `tl-button-quiet` 13, `tl-label` 9, `tl-spinner` 7,
`tl-button` 6, `tl-status` 4, `tl-dialog` 3, `tl-choice` 3, `tl-backdrop` 3, `tl-pill` 2, `tl-link` 2, `tl-field-static` 2, `tl-card` 2,
`tl-section` 1, `tl-notice` 1, `tl-icon-button` 1, `tl-fill` 1, `tl-card-header` 1; plus `sr-only` and Tailwind utilities
(`text-ink`, `text-muted`, `text-subtle`, `bg-surface`, `@lg:grid-cols-2`, `@lg:col-span-2` container queries).

| Class / token | globals.css lines | Notes |
|---|---|---|
| `:root` tokens `--background --foreground --surface-* --border-color --border-strong --text-muted --text-subtle --line-subtle --accent* --coin` | 4-45 | `html.dark` restates at 118-151 |
| `--tl-topbar-h: 4.5rem` | 51 | editor bar sticks under it; `.editor` min-height uses it - TailorIT header height must set it |
| `--layer-page-toolbar 20`, `--layer-page-overlay 200`, `--layer-app-modal 1200` | 63-72 | bar, menus, dialogs, Full size viewer |
| `@theme inline` (`--color-ink/muted/subtle/surface/line/hairline/accent...`) | 93-116 | makes `text-ink` etc. theme-aware |
| `.tl-icon-button` | 593-616 | Dialog close button |
| `.tl-fill` | 694-696 | desk `<main>` |
| `.tl-button`, `.tl-button-quiet` (+ `[data-tone=danger]`, `[data-size=sm]`, focus) | 804-866, 1021-1059 | restyled inside `.editor` |
| `.tl-card`, `.tl-card-header`, `.tl-label`, `.tl-link` | 985-1019 | |
| `.tl-check` | 1067-1071 | |
| `.tl-notice[data-tone=info|success|warn|error]` (+ dark) | 1074-1130 | `Notice`/`ErrorNotice` |
| `.tl-status[data-tone=ok|error]` | 1133-1151 | |
| `.tl-pill[data-tone=green|amber|red|sky|violet]` (+ dark) | 1154-1236 | chips |
| `.tl-choice` (+ `[data-on=true]`) | 1243-1281 | Layout radios |
| `.tl-backdrop`, `.tl-dialog` | 1301-1322 | |
| `.tl-spinner` + `@keyframes tl-spin` | 1324-1345 | |
| `.tl-section`, `.tl-field-static`, `.tl-input` (+ textarea/select/disabled, dark fixes) | 1347-1414 | |
| dark-mode shim (`html.dark .bg-white {...}` etc., unlayered) | 204-400+ | beats Tailwind `dark:` variants; new UI must use tokens (CLAUDE.md:123-135) |

`resumeEditor.module.css` restyles `.tl-label/.tl-input/.tl-choice/.tl-button(-quiet)/.tl-link/.tl-notice/.tl-pill` INSIDE `.editor`
and `.tokens` only (`:427-598`), so the editor depends on those class names existing but overrides their look.

Editor tokens (`resumeEditor.module.css:28-106`; light values): `--ed-desk #f3f1ec`, `--ed-card #ffffff`, `--ed-ink #200e32`,
`--ed-ink-2 #374151`, `--ed-muted #6b7280`, `--ed-faint #8f959e`, `--ed-line #e5e7eb`, `--ed-dash #d6d9de`, `--ed-field #f3f4f6`,
`--ed-field-hover #eceef1`, `--ed-row #f7f8f9`, `--ed-row-hover #eff1f4`, `--ed-soft #f7f8f9`, `--ed-pink #ec058a`, `--ed-pink-soft
#fdf0f7`, `--ed-pink-ring rgba(236,5,138,.2)`, `--ed-gradient linear-gradient(90deg,#ec008c 0%,#fc6767 100%)`, `--ed-primary #200e32`,
`--ed-primary-hover #35184f`, `--ed-primary-ink #ffffff`, `--ed-violet #6f4cff`, `--ed-violet-ink #5a2fe4`, `--ed-violet-soft #f1edff`,
`--ed-avatar #f3f4f6`, `--ed-avatar-ink #a3a9b3`, `--ed-switch-off #d1d5db`, `--ed-danger #b91c1c`, `--ed-danger-soft #fef2f2`,
`--ed-radius 1rem`, `--ed-bar-h 4.25rem`, shadows `--ed-card-shadow`, `--ed-card-shadow-hover`, `--ed-bar-shadow`, `--ed-gradient-shadow`;
font `var(--font-editor), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif`. Breakpoints: two columns at `min-width: 1100px`
(`:374-380`), phone padding at `max-width: 640px`; container query `@container (max-width: 30rem)` (`:1054`).

### 7.3 Backend

Measured runtime closure of `be/routes/resumes.ts` as is: **119 files** (includes `services/resumeService.ts`, `tailorCache`,
`tailorContract`, `reviseCoverage`, `jobAnalysis/facts`, `promptService`, `credits/*`, `subscriptionRepository`, `userRepository`, all
three CLI seats under `services/ai/providers/{claudeCli,codexCli,geminiCli,cli}`, `config/aiModelConfig.ts`, `utils/money.ts`...).
Packages: `express`, `multer`, `pdf-parse` (^1.1.1), `uuid` (^11), `better-sqlite3` (^12.11.1, native), `handlebars` (^4.7.8),
`puppeteer` (^24.2.0), `html-to-docx` (^1.8.0; DOCX only), Node `crypto`, `child_process` (CLI seats), `async_hooks`.

Recommended port set after the cuts in 6.2 (roughly 35 files):

| File | Lines | Keep / change |
|---|---|---|
| `be/routes/resumes.ts` | 404 | keep; swap imports per 6.2; add export route (5.5) |
| `be/routes/templates.ts` | 347 | keep the three GETs; admin writes optional |
| `be/routes/profiles.ts` | 166 | only if profiles are kept (Q1) |
| `be/routes/resume.ts` (GET `/skills`, POST `/skills/confirm`) + `be/controllers/skills.ts` | 419 / 132 | move the two skill routes to a small router |
| `be/types/resume.ts`, `be/types/profile.ts`, `be/types/template.ts` | 332 / 45 / 286 | trim `TailorMode`, `TailoredContent` only if the tailored render branch is removed |
| `be/services/resumeDocument.ts` | 843 | keep; inline `normalizeAiPreferences`, decide on file-name settings |
| `be/services/resumeImport.ts` | 237 | keep (drop the v4.1 aliases if desired) |
| `be/services/sampleResume.ts` | 394 | keep (SAMPLE_TAILORED_CONTENT only for the gallery's tailored look) |
| `be/services/extraSections.ts`, `be/services/skillGroups.ts` | 233 / 130 | keep (render gate) |
| `be/services/templateChoice.ts`, `be/services/templateImport.ts` | 69 / 399 | keep (point at the split template store) |
| `be/services/entryBullets.ts` | 263 | keep; use new `bulletHygiene.ts` and TailorIT's model resolver |
| `be/services/profileRules.ts` | 140 | keep (`resumeLabelOf`, person key) |
| NEW `services/resumeExtraction.ts` | ~30 | from `resumeService.ts:1158-1186` |
| NEW `services/bulletHygiene.ts` | ~120 | `cleanBullets` + helpers from `resumeService.ts:71-130,257-270,413-454` and `tailorContract.ts:624-635` |
| NEW `services/templateStore.ts` | ~180 | read half of `extractors/templateExtractor.ts:82-254` |
| `be/generators/pdfGenerator.ts` | 2,001 | keep the render gate/compile/preview; refactor `generateResumePDF` to a Buffer |
| `be/generators/docxGenerator.ts` | 413 | keep; return a Buffer |
| `be/generators/sectionLocator.ts`, `extraSectionsMarkup.ts`, `plainSkillsMarkup.ts` | 634 / 209 / 122 | keep |
| `be/database/documentTable.ts`, `resumeRepository.ts`, `profileTree.ts`, `profileRepository.ts`, `profileLimit.ts` | 109 / 331 / 591 / 282 / 102 | keep or simplify (Q1) |
| `be/database/skillsDatabase.ts` | 708 | keep (render + library) |
| `be/database/templateFiles.ts`, `templateRepository.ts` | 389 / 107 | keep (saved templates + overrides) |
| `be/database/sqlite.ts` | 1,350 | write a fresh schema (only the tables above); drop upgrade guard, glossary rename, migrations |
| `be/config/sectionCatalogue.ts`, `templateCategories.ts`, `staticPaths.ts`, `browser.ts`, `operational.ts` (UPLOAD_MAX_MB, JSON_BODY_MAX_MB, PDF_RENDER_TIMEOUT_MS) | 265 / 15 / 28 / 437 / - | keep |
| `be/middleware/pdfUpload.ts`, `requestSignal.ts`, `publicError.ts` | 86 / 34 / 362 | keep (`publicError` imports `services/ai/errors`) |
| `be/utils/json.ts` (`extractJSON`) | 227 | keep |
| `services/ai/*` + `services/promptService.ts` | ~2,000 + 1,806 | REPLACE with TailorIT's AI client (Risk R1) or port whole |
| `backend/static/templates/*.json` | 26 files | 19 built-ins (+7 uploaded, optional) |
| `backend/static/skills/skills.json` | 207,709 bytes | 1,492 hard (skill, priority, category) + 1,247 soft |
| `backend/static/prompts/extract-profile-from-resume.json`, `write-entry-bullets.json` | - | the two prompts (texts in Appendix A) |

### 7.4 Tests worth porting (free_tailor `backend/test/`)

`frontendEditorHelpers.test.js` (runs `lib/resumeDraft.ts`, `lib/sectionCatalogue.ts`, `lib/previewPane.ts`, `lib/resumeGallery.ts`
against the server), `frontendHelpers.test.js`, `frontendProfiles.test.js`, `resumeDraftPreview.test.js`, `sampleDefaults.test.js`,
`sectionCatalogue.test.js`, `sectionOrder.test.js`, `sectionHeadings.test.js`, `sectionSwitchesEndToEnd.test.js`, `resumeImport.test.js`,
`entryBullets.test.js`, `templateLayouts.test.js`, `skillsLayoutRender.test.js`, `resumeRender.test.js`, `templateFiles.test.js`,
`templateImport.test.js`, `profileTree.test.js`; e2e: `test/e2e/section-switches.js`, `preview-vibration.js`, `skills-layouts.js`,
`profiles.js`. Note the suite runs compiled `backend/dist` (`npm test` = `tsc && node scripts/runTests.js`, CLAUDE.md:72-103).

---

## 8. Risks and issues for TailorIT

| # | Risk | Severity | Evidence | Mitigation |
|---|---|---|---|---|
| R1 | **AI runs through local CLIs signed in to personal subscriptions** (`claude`, `codex`, `gemini`), no API keys by design; PDF import and Write with AI fail with 503 "AI generation isn't available right now..." if no seat is ready. Concurrency caps per seat (`AI_CLI_CONCURRENCY=4`, gemini 2), first-event timeouts 30-60 s. Unsuitable for a multi-user SaaS (ToS, scale, server must run CLIs). | High | CLAUDE.md:3595-3613; `.env.example:237-555`; `be/services/ai/providers/*` | Put an `AiClient` interface behind `extractResumeFromText` and `writeEntryBullets`; implement with a provider API (or keep the CLI seats only for self-hosting). |
| R2 | **Chrome/Puppeteer for PDF**: postinstall downloads Chrome; launched with `--no-sandbox`; one shared browser per process; 30 s timeout; needs ~hundreds of MB RAM; serverless-hostile. | High (for export) | CLAUDE.md:68-71; `be/config/browser.ts:383-425`; `be/generators/pdfGenerator.ts:440-466` | Dedicated render worker/container; or a hosted HTML->PDF service; keep preview Chrome-free as it is. |
| R3 | **No standalone resume PDF/DOCX export exists**; generators write to run output folders via `GeneratedPathInfo`. Simplify-style Documents needs Download. | High | `be/generators/pdfGenerator.ts:1702-1776`, `be/services/queue/resumeTask.ts:368-394`; grep shows no download in resume/profile pages | New `GET /api/resumes/:id/export?format=` returning a Buffer (5.5). |
| R4 | **DOCX does not look like the PDF** (one fixed Arial layout, accent `#2B5C8A`), html-to-docx fidelity limits. | Medium | `be/generators/docxGenerator.ts:29-60` | Decide if DOCX is offered at all; label it "Word (plain layout)". |
| R5 | **Profile tree + subscription profile limits** are wired into every create (`createResumes` -> `placeNewResume` -> `assertCanAddProfile`, 402). A job-seeker app has one person per account. | Medium | `be/database/resumeRepository.ts:208-237`, `profileTree.ts:321-343`, `profileLimit.ts:94-102` | Q1: keep one auto-profile per account (least code change) or remove profiles (simplify repository, routes, list pages, NewResumeDialog, Move, Set as default). |
| R6 | **Template preview iframes authenticate by cookie** (`src` = API origin URL; an iframe cannot send the Bearer header). Works only when the session cookie reaches the API host (same host/site); cross-site API domains + third-party-cookie blocking break the gallery. | Medium | `fe/lib/api.ts:62-77`; `be/routes/templates.ts:44,115-134` | Serve frontend and API on one site, or fetch preview HTML with `apiFetch` and use `srcDoc`, or make template previews public (they contain only sample data). |
| R7 | **Server-rendered live preview** = one POST + Handlebars compile/render per pause in typing (400 ms) per editor, plus one per thumbnail card. | Medium | `ResumeEditor.tsx:96`; `ResumeCards.tsx:85-100` | Keep the compile LRU (128); rate-limit `/preview`; cache thumbnail HTML server-side by `id:updatedAt`. |
| R8 | **FlowCV visual language**, not Simplify's: tokens, DM Sans, pink gradient Done/Add buttons, plum primary, emoji buttons (🚀 ✍️) in ImportStartDialog. | Medium | `resumeEditor.module.css:1-66`; `ImportStartDialog.tsx:77-84` | Re-map `--ed-*` tokens to Simplify's palette/type (see simplify-design report); restyle tiles/buttons; drop emoji. |
| R9 | **PDF render runs template markup with JS enabled** (no `setJavaScriptEnabled(false)`, no request interception; CSP only on previews) under `--no-sandbox` Chrome. Admin-uploaded/AI-extracted templates are arbitrary HTML. | Medium (security) | `be/generators/pdfGenerator.ts:1732-1762`; `be/config/browser.ts:383-387` | In the port: disable JS, block network requests, add the preview CSP to PDF documents too; ship only vetted built-ins. |
| R10 | **Shared global skill library**: `POST /api/resume/skills/confirm` lets any user add a skill to everyone's library; the Grouped layout's auto-headings depend on it. | Low-Medium (multi-tenant) | `be/routes/resume.ts:126-137`; CLAUDE.md:472-476 | Per-account custom skills, or confirm only into a pending list. |
| R11 | **Templates are files** in `backend/static/templates`, and saved templates are written there at runtime (atomic tmp+rename) - read-only container images and multi-instance deploys break it. | Low-Medium | CLAUDE.md:2027-2061; `be/database/templateFiles.ts` | Built-ins read-only from the image; saved templates in DB/object storage. |
| R12 | **better-sqlite3**: native module (Node ABI), single-writer, IMMEDIATE transactions, 5 s busy timeout; in-memory per-process state (`entryBullets` `inFlight`, preview compile cache, thumbnail cache client-side). | Medium (scale) | CLAUDE.md:205-207, 2143-2156; `be/services/entryBullets.ts:202` | Fine for single node; for Postgres, re-implement `DocumentTable` + tree transactions; move locks to DB/Redis. |
| R13 | **PDF import**: `pdf-parse` 1.1.1 text only (no OCR; < 50 chars refused); 10 MB cap in memory; the AI result is SAVED immediately (no review step before persistence); extraction is "copy, never infer" but still an LLM. | Medium (UX) | `be/routes/resumes.ts:336-369`; prompt in Appendix A | Optionally return the extracted draft unsaved and let the editor create it. |
| R14 | **Drift between frontend and backend copies** (section catalogue, sample placeholders, categories, limits) is held only by tests that transpile frontend libs. | Medium | `fe/lib/sectionCatalogue.ts:1-18`; CLAUDE.md:2601-2603 | Shared TS package for catalogue/types, or port the drift tests. |
| R15 | **Hidden tailoring couplings** (6.2) make a copy-paste port drag ~85 extra files (credits, subscriptions, CLI seats, tailoring). | Medium | measured closure 119 files | Do the five carve-outs first. |
| R16 | **Dark-mode shim and unlayered `.tl-*` classes**: Tailwind utilities cannot override `.tl-*` padding/height; `dark:` variants are ignored where the shim matches. | Low | CLAUDE.md:123-135; `fe/components/ui/kit.tsx:19-24` | If TailorIT does not need dark mode, drop the shim; otherwise keep the token approach. |
| R17 | **Copy is tailoring-centric** (section descriptions, switch sentences, bullet notes, sample notice mention "tailor"). | Low | 6.1 "Copy strings" row | Rewrite strings for TailorIT. |
| R18 | **After Create/Save the editor navigates to the profile page**, not back to a resume list/Documents. | Low | `ResumeEditor.tsx:429` | Point to TailorIT's Documents -> Resumes. |
| R19 | **The template list response is heavy** (every template's full HTML/CSS, 26 files, ~270 KB of markup) and is fetched by the chooser, the editor and every list page. | Low | `be/routes/templates.ts:75-95` | Add a light list endpoint (id, name, description, category, derived flags). |
| R20 | **Routes live under `/admin/`** although every user uses them; `isProfilesDeskRoute` regex and `fe/lib/roles.ts` allowlist tests key on these paths. | Low | `fe/lib/profileDashboard.ts:59-61`; CLAUDE.md:1247-1259 | Choose TailorIT paths (e.g. `/documents/resumes/...`) and update the layout switch. |

---

## 9. Open questions for the architects

- **Q1 Profiles.** Keep free_tailor's people/profile tree (one auto-created profile per account, invisible in UI) or drop it (resume
  owned by the account directly)? Dropping it removes `profileTree.ts`, `profileRepository.ts`, `profileLimit.ts`, `routes/profiles.ts`,
  NewResumeDialog, Move, Set as default, ProfileCards and the `?profile=` plumbing in the chooser/editor.
- **Q2 Subscriptions/credits.** Does TailorIT have tiers? If not, remove `ProfileLimitLink`, 402 handling and `LockedFeature`.
- **Q3 Tailoring settings on the resume.** Will TailorIT tailor resumes per job (Simplify has AI tailoring)? If not, drop
  GenerationSettingsCard (model, Building prompt, file names), `resumeSettings.resumePromptId/ai/*FileNameTemplate`, KeywordsCard,
  `/api/resume/models`, `/api/prompts`, `checkResumeModelChoice`, `savableModelChoice`, `AiPreferenceFields`.
- **Q4 Visual language of the editor.** Re-skin free_tailor's FlowCV-like editor to Simplify's palette/type (token swap) or keep FlowCV's
  look for the editor only? (User asked for Simplify style overall; Resumes "follow current repo code" for list/thumbnail views.)
- **Q5 Export formats.** PDF only, or PDF + DOCX? Where does Chrome run? (R2, R3, R4.)
- **Q6 AI provider.** Keep CLI seats or move to API-based providers for `extract-profile-from-resume` and `write-entry-bullets`? (R1.)
- **Q7 Match analysis reuse.** Simplify's Jobs page shows a resume-vs-job match. free_tailor's `services/resumeKeywords.ts` (892 lines,
  pure) and `services/resumeMatch.ts` (727 lines, pure) compute resume keywords and score a resume against a posting's analysis; worth
  evaluating with the ft-jobs report before re-inventing (INFERRED fit; not verified against Simplify's algorithm, which is UNKNOWN).
- **Q8 Template set.** Ship all 19 built-ins (+7 uploaded ATS templates)? Keep the admin template tools (upload PDF -> AI template,
  manual template builder)?
- **Q9 Import UX.** Keep "saved as soon as it is read" for PDF import, or show the parsed draft unsaved first?
- **Q10 Deployment topology.** Same-site frontend/API (needed by cookie-authenticated template preview iframes, R6)?

---

## Appendix A - the two prompts (verbatim content, `backend/static/prompts/`)

`extract-profile-from-resume.json` (variable `[[resumeText]]`; maxTokens 4000, temperature 0, JSON; runtime prompt resolution so an
admin-activated variant wins - `be/services/resumeService.ts:1162-1186`):

```
Extract structured profile data from this resume text. Be thorough and extract ALL information - and copy, never infer: every name, title, employer, date, figure, skill and sentence comes out as the resume writes it. A profile with a gap where the resume says nothing is correct; a profile with something the resume does not say is not.

RESUME TEXT:
[[resumeText]]

Extract and return a JSON object with these EXACT fields:
{ "name", "title" (headline under the name, else most recent job title), "contact": { email, phone, location, linkedin },
  "summary", "experience": [{ title, company, startDate "MM/YYYY", endDate "MM/YYYY or Present", location, description, achievements[] }],
  "skills": [], "softSkills": [], "strengths": [{ title, description }],
  "education": [{ degree, institution, startDate, endDate, location }], "certifications": [{ name, issuer, date }],
  "projects": [{ name, role, startDate, endDate, link, description, achievements[] }], "languages": [{ language, proficiency }],
  "awards": [{ title, issuer, date, description }], "publications": [{ title, publisher, date, link, description }],
  "volunteering": [{ role, organization, startDate, endDate, location, description, achievements[] }],
  "courses": [{ name, institution, date }], "interests": [] }

IMPORTANT:
- Extract ALL experience entries, not just the first one
- Extract ALL technical skills the resume names anywhere into "skills", spelled as the resume spells them. Never add a skill because a title, a project or another skill implies it ...
- Put soft skills the resume itself states (communication, mentoring, ownership...) into "softSkills", never into "skills"
- Extract ALL achievements/bullet points under each job, each as written ... keep every figure exactly as the resume states it
- Never write a figure, a date, a team size, a duration or an outcome the resume does not state ...
- If a field is not found, use empty string or empty array as appropriate
- For dates, use MM/YYYY format when the resume gives month and year; a year alone stays a year
- Take strengths only from a strengths section the resume actually has; if it has none, return "strengths": [] ...
- Take projects, languages, awards, publications, volunteering, courses and interests only from sections the resume actually has; return [] for any it lacks. A paid job is experience, never a project

Return ONLY valid JSON, no other text.
```
(The JSON skeleton above is condensed; the file spells out every field with an example value.)

`write-entry-bullets.json` (variables `[[profileJson]]`, `[[entryJson]]`, `[[task]]`, `[[instructions]]`; feature key `write-entry-bullets`;
maxTokens 1200, temperature 0.3, JSON, exact prompt id - `be/services/entryBullets.ts:235-247`): rules - only facts in the entry or note;
keep figures; 3 to 8 one-line bullets of 8-28 words, no full stop; past tense for ended entries, present for current; vary verbs; no
pronouns; a banned-word list (leveraged, utilized, spearheaded, orchestrated, streamlined, seamless, robust, scalable, ...); no bullet
starting with Designed, Architected, Led, Delivered, Drove, Integrated, Partnered, Supported, Contributed, Managed, Streamlined; no em dashes,
"--", bold, markdown or emoji; return only `{"bullets": [...]}`. Task sentences come from code (`taskSentence`,
`be/services/entryBullets.ts:144-159`): write = "Write 3 to 8 new bullets for this entry from the facts in it." (+ notes about existing
bullets); improve = "Improve the entry's existing bullets: keep every fact and figure, tighten the wording, lead each with a strong verb and
add nothing that is not in the entry. Return one improved bullet for each existing bullet, in the same order, ...".

## Appendix B - Simplify cross-references (minimal)

- Simplify's Documents page route is `/documents` - VERIFIED: `"page":"/documents"` in `__NEXT_DATA__` of the downloaded shell
  `scratchpad/simplify_raw/documents.html` (buildId `r6_zza--Zk-ux4ldkfHL7`).
- How Simplify's own resume editor looks or behaves was not researched here - UNKNOWN in this report (see the simplify-documents report).
- Brand assets to avoid from free_tailor's side: none in the resume flow (free_tailor's own icon `/tailor-icon.svg` lives in the root
  layout; the editor borrows FlowCV's LOOK - colors, DM Sans, gradient - not FlowCV assets).
