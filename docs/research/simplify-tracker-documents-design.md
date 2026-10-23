# Simplify — Job Tracker, Documents, Design System (from served assets)

Source: Explore research over Simplify's served Next.js assets (downloaded to a session scratchpad, now gone),
2026-10-22. Labels: **VERIFIED** = seen in the assets; **INFERRED** = reasoning; **UNKNOWN** = server-side.
The user's screenshots (`e2e/reference/simplify-1..7.png`, spec in `screenshots-spec.md`) override anything here.
Copy Simplify's layout, behaviour and generic UI wording — never its logo, wordmark, Simplify+ upsells or system
template texts.

---

## PART 1 — Job Tracker

### 1.1 Statuses (VERIFIED)

Numeric codes, in the order every select uses:

| value | Label | Icon | tone | Sankey colour | Default board column |
|---|---|---|---|---|---|
| 1 | Saved | BookmarkIcon | neutral | – | forced |
| 2 | Applied | SendIcon (paper plane) | blue | #4a86e8 | forced |
| 11 | Screen | DocumentSearchIcon | orange | #5E97B7 | default |
| 12 | Interviewing | ConversationIcon | purple | #47C1AD | forced |
| 13 | Offer | EnvelopeOpenIcon | green | #8BC34A | forced |
| 21 | Withdrawn | UndoIcon | red | #FFA07A | default |
| 22 | Ghosted | ChatOffIcon | red | #DDA0DD | default |
| 23 | Rejected | XCircleIcon | red | #FF6B6B | forced |
| 24 | Accepted | PartyPopperIcon | green | #4CAF50 | default |
| -1 | Archived | ArchiveIcon | – | – | hidden |

- **Column visibility:** `forced` = always shown; `default` = shown only when the column has cards; `hidden` = off.
  Saved to localStorage `columnStatus`. Eye-off button (tooltip "Hide column") sets `hidden`. Ticking a column in
  Visible columns sets `forced`, and so does "Move to" a status.
- **Status icons** render `size-4 text-muted-foreground`. `tone` values only colour email-suggestion chips.
- **Labels differ by surface:** board and selects say "Interviewing"; the list stepper says "Interview"; Sankey nodes
  say "Screening" / "Interviewing".
- **Status rules:**
  - The current status is the highest status value among the item's `status_events`.
  - Moving above Applied auto-adds an Applied event; creating an item adds a Saved event.
  - Picking a terminal status removes the other terminal events.
  - Every status event keeps its own timestamp.
- **List-view stepper:**
  - Always 5 steps: Saved, Applied, Screen, Interview, Offer. A 6th step is added only when the status is Rejected,
    Withdrawn, Ghosted or Accepted, labelled with that status.
  - Reached dot: `bg-primary-container`, inner filled circle `text-primary`. Unreached dot: `bg-card border-2
    border-control-strong`. Connector: `bg-primary-container`, else `bg-muted`.
  - Offer or Accepted turns everything success-green; Rejected, Withdrawn or Ghosted turns it grey
    (`bg-muted` / `text-subtle-foreground`).
  - Dots are 24px. Date under each dot is `M/D/YY` (`M/D` on screens ≤640px).

### 1.2 Add application (VERIFIED)

- A **right-side Sheet** (`sm:max-w-3xl`), not a modal. Header: 40px round `bg-primary-container` badge with a
  briefcase icon, title **"Add Application"** (`text-lg font-bold`), X close.
- **Fields, in order:**
  1. "Position Title"* (placeholder "Title")
  2. Company* (creatable combobox, placeholder "Company")
  3. "Location"
  4. "Job Type"* (Internship / Full-Time / Part-Time; default Full-Time, or Internship if the user prefers internships)
  5. "Job Status" (all 9 statuses; default **Applied**)
  6. "Resume Uploaded" (async combobox, placeholder "Resume used for this application", empty text "No resumes found";
     defaults to the user's default resume) — (Simplify upsell link "Unlock Multiple Uploaded Resumes": omit)
- **Validation copy:** "Required", "Must be a valid url", "Max salary must be greater than min salary",
  "Please select a salary period".
- **Footer:** "Cancel" (outline) and "Add" (primary).
- No paste-a-URL autofill. After saving, it routes to `/tracker?id={id}&editMode=true` → detail opens in edit mode.
  URL, salary and description are entered there.
- Hidden defaults sent: salary_period Yearly, currency "USD". No date-applied field; status timestamps = now.

### 1.3 Cards, menu, drag-and-drop, detail view (VERIFIED)

**Card**
- 32px logo + company (`text-sm font-medium` muted); title (`text-sm font-semibold`, 2-line clamp); pin + location
  ("X + N more" when several).
- Footer above a top border: **"Added Oct 22"** (short month + day of `tracked_date`).
- Shell: `rounded-surface border-control bg-card shadow-soft p-4`. Hover `bg-muted/40`; selected
  `border-primary bg-primary/5`.
- Favorite button: tooltip "Add to favorites" / "Remove from favorites"; outline heart muted, filled heart `text-primary`.
- "⋯" button: tooltip "Application actions".

**"⋯" menu** (same menu on right-click and on a 500ms long-press):
- "Open application"
- "View job posting" (new tab; only when there is a URL)
- separator
- "Move to ›": radio list of all 9 statuses with icons; the current one disabled
- separator
- "Archive application" / "Restore application"

**Drag-and-drop**
- @dnd-kit (mouse starts after 8px, touch after a 180ms hold, keyboard Space/arrows/Esc) + framer-motion.
- Columns 300px wide (320px on `sm`). Hovered column gets `bg-primary/5` and a `primary/30` outline; its empty-state
  text becomes "Drop application here".
- Dropping changes status. Columns load 25 cards per page, infinite scroll + a "Load more applications" button.

**Clicking a card** → `/tracker?id=…` opens a **right Sheet** `sm:max-w-7xl`.
- **Header:** 64px logo, title `text-xl font-medium` + pencil to edit, company name. Buttons: "Apply" (only when Saved
  and a URL exists), "Favorite"/"Unfavorite", "Archive"/"Unarchive", "Delete", close X. Delete confirm:
  "Delete Application" / "Are you sure you want to delete this application? You won't be able to undo this action."
- **Tabs:** Overview, Documents, Resume Score, Email (or "AI Email"), Questions; plus "Status" tab on mobile only.
  - **Overview:** Location, Salary (range + period pill), Job type, URL ("View Job Posting ↗"); job description.
    Edit mode "Edit Job Posting": Position Title, Company, Location, Job Type*, Salary as [currency (ISO list shown like
    "USD$") | "Min. Salary" | "Max. Salary" | "Pay Period": Hourly / Weekly / Bi-Weekly / Monthly / Yearly], URL
    (https:// prefix), rich-text description ("Add a job description for the posting").
  - **Documents:** "Generate a tailored document ⌄" → "Generate resume" / "Generate cover letter" (→
    `/cover-letter?trackerId=`). Linked resume with Change/Delete and "Resume Preview"; "Link existing resume" picker
    ("Search by name"). Linked cover letter with Edit/Delete and collapsible "Cover Letter Preview".
    (TailorIT: no "Generate resume" — tailoring out of scope.)
  - **Questions:** "Application Questions" + "Add Question".
- **Right column, "Application Status" card:** status combobox; vertical timeline: Saved, Applied, Screen,
  Interviewing and Offer always appear, plus any terminal statuses that occurred. Each reached step shows its date with
  a pencil → popover (date input + calendar, "Clear" / "Save", future dates blocked). Unreached steps show "Add date".
- **Notes** (rich text) below: placeholder "Add notes, reminders, or contacts for this job", autosaves after 500ms.
- Reaching Offer or Accepted plays an 8-second confetti animation.
- No contacts or interviews sections.

### 1.4 Chart view (VERIFIED)

- "Chart" tab (internal `sankey`) hides search and filters.
- **"Application flow"** card: a Nivo Sankey of status transitions. Nodes draggable: "Drag stages to rearrange your
  chart. Reset positions to restore the default layout." Buttons: "Reset chart positions", "Export chart as PNG",
  ("Copy chart link", "Save & Share" — Simplify-specific, optional). Empty: "No applications to chart yet" /
  "Track an application to see its path from applied to offer."
- **"Insights"** cards:
  - "Application activity": "Total applications", "Most active day" ("Monday (N apps)"), averages Per day / Per week /
    Per month.
  - "Conversion funnel": percentage bars "Applied → Screening", "Screening → Interview", "Interview → Offer".
  - "Response & follow-up": "Average response time" (days), "Ghost rate" (%), "Longest wait" (days + job title).
  - ("Demographic information" — Simplify-specific, omit.)

### 1.5 Options menu, CSV, tabs, search, empty states (VERIFIED)

**Options trigger:** pill with sliders icon + "Options" + count of applied filters; opens on hover; menu 240px (`w-60`).

**Filters**
- "Applied from ›" / "Applied until ›": submenu with single-date calendar (month/year dropdowns) and
  "Clear applied from" / "Clear applied until".
- "Job type ›": radio Internship / Full-Time / Part-Time, plus "Clear job type".
- "Status ›": checkboxes for all 9 statuses with icons, plus "Clear status".
- "Clear all filters" once any filter is set.
- Choosing a status filter **switches the view to List**.

**View options**
- "Show only favorites"
- "Visible columns (N) ›" (board only): one checkbox per status + Archived, each with icon and live count "(N)".
- "Sort by ›": Tracked Date (default) / Created Date / Title, then Ascending / Descending (default descending).

**Active filter chips** under the toolbar: "From Oct 22", "Until Oct 22", the job type, each status, "Favorites",
"Sort: tracked date (desc)". Each removable, plus "Clear all filters".

**Actions**
- **"Manage jobs"** = select mode: "N Job(s) Selected" + select-all checkbox, and Archive / Unarchive / Delete /
  "Update Status" / Done. Confirms: "Delete Applications" ("…delete all these applications? You won't be able to undo
  this action."), "Archive Applications", "Unarchive Applications". Bulk status: "Warning": "Are you sure you want to
  update the status of these N applications?"
- **"Import CSV"** dialog "Import Applications from CSV":
  1. Dropzone "Choose CSV File", hint "Expected headers: Company name, Position Title. Location is optional."
  2. Pick the "Header row".
  3. **"Map your columns"**: required Position Title and Company; "Show optional fields" reveals Location, Job Type,
     Status, Notes, Job Posting Link, Application Date. Any field can be a "Custom value" constant; date formats
     auto-detected.
  4. Preview. 5. Resolve unknown companies. 6. "Map status values". 7. Resolve job types.
  8. "Processing rows..." (per-row Skip Row / Retry Row). 9. "Import Complete": "All N applications imported successfully!"
  - No job type mapped → guessed from title: intern/co-op → Internship; part-time/contract/temp/freelance → Part-Time;
    else Full-Time.
- **"Export CSV"** ("Exporting CSV…"), server-generated with current filters. Columns UNKNOWN → TailorIT defines.
- **"Archive all applications"** confirm: title "Archive all applications", body "Are you sure you want to archive all
  applications?", button "Archive".

**Tabs:** "Active (N)" / "Archived (N)". Archived **forces List view**. Back to Active restores the last view; choosing
Board or Chart while on Archived switches back to Active.

**Search:** placeholder "Search for roles or companies", 500ms debounce, server-side.

**Empty states**
- Board column: "No applications" / "Move applications into {status in lowercase}."
- List, none: "Add your first job application!" / "No more endless spreadsheets, keep track of everything in one place."
- List with filters: "Oops! No matching applications found." / "Please update your search criteria and try again."

---

## PART 2 — Documents

### 2.1 Documents page (VERIFIED)

- **Action cards:** New Resume → resume builder; New Cover Letter → `/cover-letter`; New Template →
  `/cover-letter-template`; (Question Response — out of scope).
- **Toolbar:** left "{n} selected" (an X "Clear selection" when n > 0). **Only bulk action: "Delete".** Confirms:
  "Delete Resumes" / "Delete Cover Letters" / "Delete Templates", button "Delete Bulk", body "Are you sure you want to
  delete these N resumes? You won't be able to undo this action." plus "N default resume will be skipped" /
  "N system default template(s) will be skipped". Shift-click selects a range.
- **Per-tab controls:** Resumes: Upload | "All ⌄" (All / Generated / Uploaded) | Search. Cover Letters: Upload | Search.
  Templates: Upload | Search (client-side name filter).
- **Table columns** (all tabs): Name / Created / Last Edited / Actions. Relative dates, "-" when empty.
- **Row badges:** Resumes "Default" (filled primary), "Generated"/"Uploaded", "PDF"/"DOCX". Cover letters
  "Generated"/"Uploaded". Templates: name + **"System Default"** badge + 80-character plain-text preview of the body
  ending in "...". System-default rows cannot be selected.
- **"More ⌄" menus** (176px wide):
  - Resume: View, Rename (modal "Change resume name", buttons "Keep it" / "Change"), Download, Set as default,
    separator, Delete.
  - Cover letter: View (generated letters; dialog "Cover Letter Preview"), Rename, Download (PDF), separator, Delete.
  - Template: **Duplicate** ("{name} (Copy)"), separator, Delete (disabled for system defaults).
- **Upload:**
  - Resumes → "Upload Resume" dialog: File name field ("Ex. John_Doe_Finance"; hint "On upload your resume will be
    named First_Last_resume"); **"PDF, DOC, DOCX up to 5 MB"**; checkbox "Parse this resume to update your profile
    information".
  - Cover letters / Templates: accept `.pdf,.docx`; text extracted, split into paragraphs, `{ {X} }` → `{{X}}`; creates
    a document named after the file, then opens the editor. Errors: "Unsupported file type" / "Please upload a PDF or
    DOCX file.", "Could not read file", "Upload failed".
- **Empty states:**
  - Resumes: "Create your first resume!" / "Get started with a polished resume that highlights your skills and experience."
  - Cover letters: "Create your first cover letter!" / "Get started with a personalized cover letter that highlights your qualifications."
  - Templates: "Create your first template!" / "Get started by creating a reusable cover letter template with dynamic placeholders."
  - No search match: "Oops! No matching {resumes|cover letters|templates} found."

### 2.2 New Cover Letter flow and editor (VERIFIED)

- `/cover-letter` immediately creates **`Cover Letter ${new Date().toLocaleDateString()}`** (linked to `?trackerId`) and
  redirects to `/cover-letter/{id}`. The generate modal opens automatically when the letter is empty.
- **Modal "Generate a Tailored Cover Letter"**, three tab buttons:
  - **"Job Details"** ("Add or edit the job information…"): "Select a job from tracker" ("Search a job"; fills the
    fields below), "Company Name" (ex. Google), "Job Title" (ex. Software Engineer), "Job Description".
  - **"Template"** ("Optionally select a template to generate your cover letter from."): "None (generate without
    template)" + each template (" (Default)" suffix), with a preview box. Empty: "No templates available. Create one
    from the Documents page."
  - **"Custom Prompt"** ("Add additional context or instructions"): textarea placeholder "Paste in an existing cover
    letter OR provide some context for … AI to expand upon…". "Load an example" inserts "Emphasize my skills and
    experience in [REPLACE] and how that relates to [COMPANY]'s mission of [REPLACE]".
  - No resume picker, no tone control.
- **"✨ Generate"** progress loader: "Analyzing job description...", "Extracting key skills and requirements...",
  "Generating your tailored cover letter...".
- Without a template: AI returns body text; wrapped as centered H1 user's name, centered "phone | email | linkedin",
  "Dear Hiring Manager,", paragraphs, "Sincerely,", name. With a template: server fills it using job info and prompt.
- **Editor top bar** (62px): logo › Documents › name. Inline rename with ✓/✗ (min 3 chars). ⓘ tooltip: "This name is
  only for your documents list. It is not shown inside the letter unless you add it in the editor." Save status:
  "Saving…", "Saved just now", relative time, or "Error saving". **"Export Cover Letter"** button. ☰ menu:
  "Export to PDF", "Import from PDF/DOCX", "New cover letter", "Delete this cover letter".
- **Toolbar** (TipTap): font select, B / U / I, link, H1–H3, 4 alignments, blockquote, bullet list, numbered list, undo,
  redo, **"✨ Generate"**. Tooltips show shortcuts (Ctrl+B, Ctrl+K, Ctrl+Alt+1–3, Ctrl+Shift+L/E/R/J/9/8/7, Ctrl+Z/Y).
- **Fonts:** Times New Roman (default), Helvetica, Courier, OpenSans, Roboto, Lato, Poppins, Arimo, WorkSans, RobotoMono.
- **Paper:** placeholder "Dear Hiring Manager...". Autosaves 1 second after typing stops.
- **Unfilled placeholders banner** (amber): "Almost there - fill in these details to finish your letter" / "Click a tag
  to replace it." + clickable chips → **"Replace placeholder"**: "All tags named {{X}} will become the text you enter
  below." (Cancel / Apply; replaces every copy).
- Download: PDF (named `{name}.pdf`).

### 2.3 Template editor (VERIFIED)

- `/cover-letter-template` creates `Template ${new Date().toLocaleString()}` and redirects.
- **Top bar:** rename ≥3 chars: "Template name must be at least 3 characters long". ⓘ tooltip: "This name appears in
  your documents list when you choose a template for a cover letter." **"✨ Copilot AI Prompt"** modal: "This prompt
  will be used as additional context when generating a cover letter from this template." Textarea, 1000-char limit +
  counter, Save. ☰ menu: Export to PDF / Import from PDF/DOCX / New template / Delete this template.
- **Editor placeholder:** "Write your template here using placeholders, or leave it empty and use the AI Prompt to
  generate the entire cover letter."
- **"Insert variable..."** (searchable, grouped; each option shows label + description). Groups: **Profile**,
  **Dynamic**, **Structural**, **AI Generated**. Simplify's full list is server-side (UNKNOWN) → TailorIT registry.
- **Known names:** AI-written FULL_COVER_LETTER, COVER_LETTER_BODY, COMPANY_APPEAL, ROLE_FIT, CANDIDATE_STRENGTHS,
  SKILL_HIGHLIGHT; plain COMPANY_NAME, JOB_TITLE (Dynamic), USER_FULL_NAME (Profile).
- **Chip behaviour:** atomic, draggable. Inline style: 4px radius, padding 1px 6px, 0.85em, weight 500, bg `#e9f6ff`,
  text `#016094`. Typing `{{NAME}}` turns into a chip; hover shows the description; saved as plain `{{NAME}}`.
- **"Base from template…"** (tooltip "Replace editor content with a copy of another template"): lists the user's other
  templates incl. system defaults; selecting one replaces the content immediately.

---

## PART 3 — Design system (VERIFIED from CSS)

### 3.1 Font
- UI font **"Circular Std"** (commercial, Lineto; self-hosted Book 400 / Medium 500 / Bold 700 / Black 900).
  Stack: `Circular Std, ui-sans-serif, system-ui, sans-serif`, line-height 1.5. → TailorIT uses **Figtree** (OFL).

### 3.2 Sizes, radii, shadows, focus
- Type: page H1 `text-2xl` / `sm:text-3xl` bold; dialog titles `text-lg font-semibold tracking-tight`; body and labels
  14px; meta 12px; segmented tabs 15px; underline tabs 16px.
- Radii: `--radius` 8px (md 6, sm 4); **control 10px** (buttons, inputs, icon tiles); **surface 16px** (cards, kanban
  cards, dialogs, table card); popup 14px; menu 10px; menu row 6px; shell 20px; pills/badges/segmented tabs full.
- **Button:** `h-9 px-4 text-sm font-medium` (sm: h-8 text-xs; lg: h-10 px-8). Variants: default (#14a1c0),
  secondary (#ebebeb), outline (border #dfdfdf + `shadow-control`), ghost, destructive, destructive-soft,
  destructive-outline, link.
- **Input:** `h-9 rounded-control border #e6e6e6 bg-card shadow-soft px-3`. Placeholder #a1a1a1; hover border #d7d7d7;
  focus border #969696 (no ring).
- **Badge:** `rounded-full border px-2 py-0.5 text-xs font-medium`.
- **Shadows:**
  - soft (cards): `0 1px 10px rgb(0 0 0/.008), 0 3px 10px -2px rgb(0 0 0/.015), 0 6px 16px rgb(0 0 0/.02)`
  - control: `0 1px 2px rgb(0 0 0/.05)`
  - menus: `0 10px 15px -3px #0000000f`, white at 94% opacity + backdrop blur, 1px outline at 6% black; row hover 6% black
  - popovers: `0 8px 24px -6px rgb(14 18 27/.08), 0 2px 6px -2px rgb(14 18 27/.04)`
  - dialogs: `0 24px 48px -12px rgb(0 0 0/.18), 0 8px 16px -8px rgb(0 0 0/.08)`, backdrop 40–50% black
- **Segmented tabs:** track black at 4% (= #f2f2f2 on #fcfcfc, #f5f5f5 on white). Active pill white + 6% black border;
  hover #e5e5e5.
- **Focus:** keyboard only (`data-input-modality=keyboard`). 2px outline, offset 2px, #08758c, or `ring-2` primary/30%.
- **Motion:** easing `cubic-bezier(.22,1,.36,1)`, 232ms / 384ms.

### 3.3 Colour tokens
| Token | Hex |
|---|---|
| `--primary` (bg only) | #14a1c0 |
| `--primary-ink` (text-/border-/outline-primary, ring) | #08758c |
| `--primary-container` | #ccf6ff |
| `--background` / `--canvas` | #fcfcfc |
| `--surface-low` | #f8f8f8 |
| `--border` / `--muted` | #e8e8e8 |
| `--foreground` | #191919 |
| `--muted-foreground` | #7d7d7d |
| `--subtle-foreground` | #a1a1a1 |
| `--surface-high` / `--border-control-strong` | #d7d7d7 |
| `--chip` / `--control-fill` | #ebebeb |
| `--tint-sky` / `--tint-sky-foreground` | #e9f6ff / #016094 |
| `--success` / container | #02a558 / #d6f9e9 |
| `--destructive` / container | #f53b3a / #fbe5e5 |
| `--status-warning` | #f58e3a |
| `--tint-amber` / fg | #f8f4e5 / #913f0c (placeholder banner) |
| primary scale | 200 #adebfe, 300 #44bfdf, 400 #14a1c0, 500 #0b8ba6 |
| avatar (sampled) | #3ec0de |
| improve card (sampled) | #def9ff, border #d4f7ff |

### 3.4 Icons
- Simplify's own `createIcon` set: 16×16 viewBox, `fill="currentColor"`, filled paths. No third-party icon library.
  → TailorIT uses @phosphor-icons/react (regular + fill weights).
- Libraries Simplify uses: Base UI, TipTap, react-select, @dnd-kit, framer-motion, Nivo, html-to-image.

## Still UNKNOWN (server-side)
Complete placeholder list; system cover-letter template names/bodies; Export CSV columns; letter/template upload size
limit; how Insights are computed.
