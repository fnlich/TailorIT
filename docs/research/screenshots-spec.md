# Simplify UI — spec from the user's screenshots (AUTHORITATIVE)

Source images (user-supplied, logged-in Simplify, 2026-10-22). Read them directly with the Read tool when building UI:
`C:\Users\Kelvin\AppData\Local\Temp\claude\f--Develop-TailorIT\3e5e2405-8333-495c-b973-a88d115cb0dc\images\`
1.png Jobs page · 2.png Tracker board · 3.png Documents/Resumes · 4.png Documents/Cover Letters · 5.png Cover-letter template editor · 6.png Tracker "Options" menu · 7.png Tracker list view.

When this file or the images disagree with research inferred from Simplify's JS/CSS, THE IMAGES WIN.
The bright green `#00ff00` behind "Remote" and yellow `#ffff66` behind "Hybrid" are a browser highlighter extension on the user's machine, NOT Simplify UI — ignore them (render "Remote"/"Hybrid" as plain text).
Brand assets to avoid: the Simplify logo mark + wordmark, "Simplify+" name and its lightning badge, "Partners" brand icon. TailorIT uses its own name/logo.

## Colors — sampled from pixels (VERIFIED)

| Token | Hex | Where seen |
|---|---|---|
| primary | `#14a1c0` | Apply, Add application, Tailor my resume buttons; "Default" badge bg |
| primary-strong | `#08758c` | filled favorite heart; tracker stepper "done" dot |
| accent / avatar | `#3ec0de` | user avatar square bg (logo mark also uses it — logo itself is a brand asset) |
| primary-tint | `#ccf6ff` | selected job card bg; "Full-Time" pill; matched keyword chip; doc action icon tile; stepper done line + dot ring |
| primary-tint-soft | `#def9ff` (border `#d4f7ff`) | "Improve Your Resume" card |
| variable-chip | bg `#e9f6ff`, text `#016094` | `{{VARIABLE}}` chips in template editor |
| success | `#02a558` | green check next to matching seniority ("Senior ✓") |
| page-bg | `#fcfcfc` | app background under header (Jobs, Tracker, Documents) |
| canvas-bg | `#f8f8f8` | editor canvas behind the paper; documents table header row |
| surface | `#ffffff` | header, cards, panels, inputs |
| border | `#e8e8e8` | header bottom border, card/table borders, row dividers, tabs baseline, nav active tab bg |
| divider-soft | `#f2f2f2` | divider inside tracker cards; segmented-control container (tracker) |
| segmented-bg | `#f5f5f5` | "Summary / Full posting" toggle container (jobs) |
| neutral-pill | `#ebebeb` | "Confirmed live…" pill, "Applied 10/22/26" pill, filter count badge bg |
| text | `#191919` | primary text, active nav underline, active tab underline |
| text-muted | `#8b8b8b` (≈`#898989`/`#8a8a8a`) | secondary text, counts, column-hide icon |
| icon-muted | `#a1a1a1` | "+" on action cards |
| text-disabled | `#b7b7b7` | disabled "Edit" on uploaded PDF resume |
| step-todo-line | `#e8e8e8`; step-todo-dot border `#d7d7d7` | tracker list stepper |
| company-initial-bg | `#e8e8e8` | letter avatar on tracker cards |

Typography: geometric grotesque sans for the UI (exact family: see research/simplify-design.md); primary text `#191919`. Template editor paper defaults to "Times New Roman".

## Global header (all screenshots)
- White bar, ~62px tall, bottom border `#e8e8e8`, full width; content left-aligned with ~30–45px side padding.
- Left: logo (TailorIT's own). Then nav items (Simplify: Matches, Jobs, Job Tracker, Documents, Services, Refer ⌄). **TailorIT shows: Jobs, Job Tracker, Documents.**
- Nav item: ~16px text, inactive gray; ACTIVE = full-header-height block with bg `#e8e8e8`, text `#191919`, and a ~2–3px `#191919` underline at the bottom edge.
- Right: icon buttons (Simplify: extension puzzle, announcements megaphone, help "?", notifications bell) → TailorIT keeps help + bell (optional) ; then avatar: ~40px rounded-md square, bg `#3ec0de`, white bold initials ("DJ"), followed by chevron-down opening the account menu.

## 1.png — Jobs page
- Toolbar row: search pill (rounded-full, border, white, ~36px tall, ~490px wide, magnifier icon, placeholder **"Find your dream role"**). Right-aligned filter pills (rounded-full, border, white, 14px): **Location ⇕**, **Job Type [1]**, **Experience Level ⇕**, **Category [2]** — `[n]` = small round count badge (`#ebebeb` bg, gray text) when the filter has selections; `⇕` (up/down chevrons) when empty. Then a filter-lines icon button (more filters), a bookmark icon button (saved jobs), and an ✕ circle button (clear).
- Two panels on `#fcfcfc`:
  - LEFT list panel (~475px): white card, border; header row: "Found 17,480 jobs" (12px muted) left, sort "Most relevant ⌄" right. Job cards (~135px tall, ~16px padding): logo 40px rounded; **title** 16px semibold; company 14px muted; "City, Region, Country · Hybrid|In Person|Remote" 14px muted; optional salary "£325k - £390k/yr · " then posted "2 months ago" (12px muted); outline bookmark icon top-right. Selected card bg `#ccf6ff`. Panel scrolls independently.
  - RIGHT detail panel: white card. Top bar: tabs **Overview** (active, 2px `#191919` underline) | **Company**; right: **"Applied 10/22/26"** (`#ebebeb` pill-button, shown once tracked as applied), **Save** (outline, bookmark icon), **Apply** (primary teal, white text).
  - Company row: logo 48px, company name 18px semibold, one-line company tagline muted; right: eye+chevron (hide), share, flag (report) icon buttons.
  - Job title 24px bold.
  - Tag pills: job type **"Full-Time"** (`#ccf6ff` bg, teal text); **"Confirmed live in the last 24 hours"** (`#ebebeb`, clock icon); (Simplify-only "Unlock job analytics Simplify+" lock pill — premium upsell, omit or replace).
  - Facts grid, 3 columns, icon + 14px semibold: salary ("No salary listed" or range), seniority ("Senior" + green check-circle when it matches the user), location, work model ("In Person"), category ("DevOps & Infrastructure" + sub-line "Site Reliability Engineering" regular).
  - Divider, then two columns. Main: **"About the job"** (22px bold) with segmented toggle **Summary | Full posting** (`#f5f5f5` container, white active). Summary shows "Requirements" (18px semibold) bullet list (15px, relaxed leading) [and other summarized sections]; Full posting shows the raw description.
  - Sidebar (~300px): **JOB ANALYSIS = "Improve Your Resume" card** — bg `#def9ff`, border `#d4f7ff`, rounded-xl; teal target icon + title "Improve Your Resume"; line "**5** out of **13** required keywords found"; keyword chips: matched = `#ccf6ff` bg + teal text + check-circle icon; missing = white bg + border + dark text; "Show 8 more ⌄" teal link; full-width primary button **"Tailor my resume"**. Below it a white "Get Referred For This Role" card (Hiring Managers) — out of scope unless cheap.

## 2.png — Job Tracker, Board view
- Row 1: segmented tabs in `#f2f2f2` rounded-full container: **Active (87)** (active = white pill with border), **Archived (0)**, (Simplify-only "Partners" — omit). Right: primary button **"+ Add application"**.
- Row 2: search pill full width, placeholder **"Search for roles or companies"**. Right: view switcher (`#f2f2f2` container, white active): **Board** (columns icon) | **List** (rows icon) | **Chart** (line-chart icon); then **Options ⇕** button (white, border, rounded-full, sliders icon) → menu in 6.png.
- Columns (~320px wide, ~12px gap, horizontal scroll): header = status icon + **name** (14px semibold) + count (12px muted) + eye-slash "hide column" icon at right. Visible: **Saved** (bookmark), **Applied** (paper-plane), **Screen** (file-search), [**Interview** hidden in this capture — "Visible columns (5)"], **Offer** (envelope-open), **Rejected** (x-circle).
- Card: white, border `#e8e8e8`, rounded-xl, 16px padding: company letter avatar (32px, `#e8e8e8`, muted letter) + company name (14px muted, truncate) + favorite heart (outline muted / filled `#08758c`) + "⋯" menu; **title** 14px bold; pin icon + location ("Remote in USA"); soft divider `#f2f2f2`; "Added Oct 22" (12px muted). Cards are draggable between columns.
- Empty column: dashed `#e8e8e8` border, rounded-xl, ~155px tall, centered **"No applications"** (14px semibold muted) + **"Move applications into {status}."** (12px muted).

## 6.png — Tracker "Options" menu
White popover, rounded-xl, shadow, ~240px. Sections with small muted headings:
- **Filters**: Applied from ›, Applied until ›, Job type ›, Status ›
- **View options**: Show only favorites [checkbox], Visible columns (5) ›, Sort by ›
- **Actions**: Manage jobs, Import CSV, Export CSV — separator — Archive all applications (each with a leading icon).

## 7.png — Job Tracker, List view
- One white bordered rounded-xl row card per application (~105px tall): outline heart (favorite) at far left; company logo 64px rounded-xl; **title** 16px semibold; building icon + company (14px muted); pin icon + location.
- Progress stepper (≈570px wide): steps **Saved — Applied — Screen — Interview — Offer**; label above each dot (12px); done dot = `#08758c` center with `#ccf6ff` ring; todo dot = white with `#d7d7d7` border; connector done `#ccf6ff`, todo `#e8e8e8` (~4px); the date reached ("10/22/26") under each done dot.
- Right: **Status ⌄** select button (white, border, rounded-md) to change status.

## 3.png — Documents (Resumes tab)
- Page heading **"My Documents"** (~32px bold) + subtitle **"Manage and tailor all of your job search documents here!"** (16px muted).
- Action cards row (4 equal columns, 16px gap): white, border, rounded-xl, ~88px tall: 40px icon tile (`#ccf6ff` bg, teal icon) + title (16px semibold) + description (13px muted) + "+" at right (`#a1a1a1`):
  **New Resume** — "Craft and tailor to job description"; **New Cover Letter** — "Create and customize with AI"; **New Template** — "Create a reusable cover letter template"; (Simplify's 4th "Question Response" is out of scope.)
- Tabs: **Resumes** (active `#191919` + 2px underline) | **Cover Letters** | **Templates**; full-width `#e8e8e8` baseline.
- Table card (white, border, rounded-xl): toolbar = "**0 selected**" (muted) left; right: **Upload** (outline button, upload icon), **All ⌄** select (resume source filter), **Search** input (wide). Header row bg `#f8f8f8`: [checkbox] **Name** · **Created** · **Last Edited** · **Actions** (14px semibold). Rows (~77px): checkbox; name (14px semibold) + badges under it — **Default** (`#14a1c0` bg, white, rounded-full), **Uploaded**, **PDF**, **Generated** (white, `#e8e8e8` border, rounded-full, 12px); Created / Last Edited as relative time ("3 days ago"); Actions: **✎ Edit** (disabled `#b7b7b7` for uploaded files) and **More ⌄** dropdown. Row dividers `#e8e8e8`.
- NOTE (user requirement): TailorIT's Resumes tab follows free_tailor's **list view + thumbnail view** (with a view toggle), restyled into this visual language.

## 4.png — Documents (Cover Letters tab)
Same table card; toolbar: "0 selected", **Upload**, **Search** (no source select). Rows: "**Cover Letter 10/22/2026**" + **Generated** badge; Created "2 hours ago"; Last Edited "-"; Edit / More ⌄.
NOTE (user requirement): Cover Letters get BOTH this list view and a thumbnail view (toggle).

## 5.png — Cover-letter template editor (full-screen, no main nav)
- Top bar: logo, breadcrumb "› [doc icon] **Documents** › **Creative Industry Cover Letter** ✎ (rename) ⓘ (info)". Bottom border `#e8e8e8`.
- Formatting toolbar (white, bottom border), centered: font family select (default "Times New Roman"), **B**, **U**, *I*, link, H1, H2, H3, align left/center/right/justify, blockquote, bullet list, numbered list, undo, redo.
- Under it, centered: **"Insert variable..."** select and **"Base from template..."** select (~280px each).
- Paper: white page (~900px wide, letter proportions) centered on `#f8f8f8`, generous margins, serif body text.
- Variables render as inline chips: bg `#e9f6ff`, text `#016094`, slight radius, e.g. `{{COMPANY_NAME}}`, `{{JOB_TITLE}}`, `{{COMPANY_APPEAL}}`, `{{SKILL_HIGHLIGHT}}`, `{{CANDIDATE_STRENGTHS}}`, `{{USER_FULL_NAME}}`. Syntax is `{{UPPER_SNAKE}}`. Some are plain substitutions (company, job title, user name); others (COMPANY_APPEAL, SKILL_HIGHLIGHT, CANDIDATE_STRENGTHS) are AI-written paragraphs filled at generation time.
- Example template body (verbatim from 5.png): "Dear Creative Team at {{COMPANY_NAME}}, / I am thrilled to apply for the {{JOB_TITLE}} position at {{COMPANY_NAME}}. / {{COMPANY_APPEAL}} / My creativity and unique perspective would be a valuable addition to your team. / {{SKILL_HIGHLIGHT}} / {{CANDIDATE_STRENGTHS}} / I look forward to the opportunity to contribute to the innovative work being done at {{COMPANY_NAME}}. / Thank you for considering my application. / Sincerely, {{USER_FULL_NAME}}"
