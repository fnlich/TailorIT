# ft-resume-views: free_tailor's resume List view and Thumbnail (Grid) view, mapped for TailorIT

Research key: `ft-resume-views`. Source: local clone `F:/Develop/free_tailor` (branch v5.0 = v4.2, commit 4112e8e, clean tree), read only.
All paths below are relative to `F:/Develop/free_tailor/` unless absolute.

Evidence labels used here:

- **VERIFIED (code)**: read in the free_tailor source at the cited file:line.
- **VERIFIED (asset)**: seen in a downloaded Simplify asset (path given).
- **INFERRED**: worked out from the code (arithmetic, consequences) or a design proposal for TailorIT.
- **UNKNOWN**: could not be established here. Other research keys (simplify-documents, simplify-design, ft-cover-letters) cover Simplify itself.

---

## 0. TL;DR for the architects

1. free_tailor has ONE pair of views, used on two pages: the dashboard `/admin/profiles` (tabs **Profiles** and **All resumes**) and one profile's page `/admin/profiles/<id>`. Both pages render the same `ResumeCard` (Grid) and `ResumeRow` (List) from `frontend/src/components/resume/ResumeCards.tsx`. Profiles get their own `ProfileCard` / `ProfileRow` (`frontend/src/components/profiles/ProfileCards.tsx`). VERIFIED (code).
2. **Grid ("thumbnail") view**: a CSS grid of `auto-fill, minmax(min(100%, 13.75rem), 1fr)` cells, with exactly 2 columns at 640px and below. The first cell is a dashed "New resume" tile the size of a page. Each card is the resume's **first page**, the actual server render, framed as an `<iframe srcdoc sandbox="">` laid out at A4 794x1123 CSS px and scaled down by `transform: scale(boxWidth/794)`. Under it are the headline, an optional profile link, `Edited 6 hours ago · <template>`, and a ⋮ menu. VERIFIED (code).
3. **List view**: a `<ul>` of rounded white "rows" laid out with CSS grid (`minmax(0,2.2fr) minmax(0,1.4fr) minmax(0,1.4fr) 10rem 2.5rem`). A visual header row is `aria-hidden`. The columns are Resume | Profile (or "Name on resume") | Template | Edited | ⋮. There are no thumbnails. At 640px and below the cells stack in one column, with the ⋮ in a second column. VERIFIED (code).
4. **The chosen view persists** in `localStorage["freeTailor.profiles.view"]` (`'grid'` or `'list'`; anything else reads Grid). That one key is shared by every Profiles page. It is read in a lazy `useState` initialiser and written on each change, with every access in try/catch. The dashboard tab is in the URL (`?tab=resumes`). VERIFIED (code).
5. **Search** is client-side, case-insensitive substring matching over label, name and profile name. A `role="status"` line reads `1 of 3 resumes match.`, and Clear hands focus back to the input. **Sort is fixed** (newest `updatedAt` first, then id; on a profile's page the default resume comes first). There are **no filters, no pagination, no virtualization and no multi-select**. VERIFIED (code).
6. **Thumbnails cost one `POST /api/resumes/preview {resume:{}, resumeId, sample:false}` each.** A request is sent only when the card comes within 300px of the viewport (IntersectionObserver). The client keeps a module-level LRU of 24 rendered HTML pages keyed `id:updatedAt`, plus de-duplication of in-flight requests. The **server caches nothing** about the render; only compiled Handlebars delegates are kept, in an LRU of 128. VERIFIED (code).
7. **free_tailor has no cover-letter entity.** A cover letter exists only as text inside tailoring output (`TailoredContent.coverLetter`), saved straight to PDF/DOCX files. There is no table, list endpoint, preview endpoint or editor for it. Documents > Cover Letters needs new storage, CRUD, a list summary and a preview renderer. The two views themselves can be generalized cheaply, because `PageThumb`, `ActionMenu`, `SearchBox`, `ViewToggle` and `focusAfterRemoval` are already kind-agnostic. VERIFIED (code) for the absence; INFERRED for the plan.
8. **The look of these views is FlowCV's, not Simplify's.** The source says so ("drawn after FlowCV's"): a warm desk `#f3f1ec`, plum `#200e32`, pink `#ec058a`, a pink-to-coral gradient and DM Sans. All colours go through `--ed-*` tokens plus about 10 literals, so a Simplify re-skin is a token swap. VERIFIED (code).
9. **The views are coupled to "profiles" (persons).** Examples: the profile column and link, ★ Default, Move to another profile..., the profile-limit lock, and filing by person name on create. Simplify has no such concept (INFERRED). TailorIT must decide whether to drop or hide it (see Open questions). The free_tailor *profile page* variant (`profile = null`) is already the "no profile column" layout: Resume | Name on resume | Template | Edited.

---

## 1. Where the views live

### 1.1 Routes and pages (VERIFIED code)

| Route | File | What it shows |
|---|---|---|
| `/admin/profiles` (and `?tab=resumes`) | `frontend/src/app/admin/profiles/page.tsx` (609 lines) | "My Profiles" dashboard. Tab **Profiles (N)**: ProfileCard / ProfileRow. Tab **All resumes (M)**: ResumeCard / ResumeRow with the profile column and link. |
| `/admin/profiles/<profileId>` | `frontend/src/app/admin/profiles/[profileId]/page.tsx` (451 lines) | One person's resumes: ResumeCard / ResumeRow with `profile = null`, default resume first. |
| `/admin/resumes/<id>` | (editor; not in scope) | Target of every card and row link: `resumeEditorHref` at `ResumeCards.tsx:17-19`. |
| `/admin/resumes/new[?profile=<id>]` | (template chooser; not in scope) | Target of the New resume tile: `newResumeHref` at `lib/profileDashboard.ts:69-72`. |

`app/admin/layout.tsx:17-31` gives these routes a bare `<main className="tl-fill">` (via `isProfilesDeskRoute`, `lib/profileDashboard.ts:59-61`, regex `^\/admin\/(?:profiles(?:\/[^/]+)?|resumes\/[^/]+)\/?$`). Each page draws its own full-bleed "desk": `<div className={editorCss.editor + editorFont.variable}><div className={css.page}>...`.

### 1.2 Component tree (VERIFIED code)

```
ProfilesPage (Suspense: useSearchParams)                       app/admin/profiles/page.tsx:79
└─ ProfilesDashboard                                           :95
   ├─ header: h1 "My Profiles", welcome line, usage line, Import ▾ (ActionMenu), Create New
   ├─ notices (.notices): limit warnings, success Notice, ErrorNotice(s)
   ├─ role=tablist "Profiles and resumes": Profiles (N) | All resumes (M)
   └─ role=tabpanel
      ├─ .controls: <SearchBox/>  <ViewToggle/>                components/profiles/SearchBox.tsx, ViewToggle.tsx
      ├─ <p role=status class=matchStatus>                     "1 of 3 resumes match."
      ├─ Grid: <ul class=resumeGrid> <li><NewTile/></li> <li><ResumeCard|ProfileCard/></li>...
      │        ResumeCard → ResumeThumb → PageThumb (iframe srcdoc)   components/resume/ResumeCards.tsx, PageThumb.tsx
      │                   → ActionMenu (⋮)                             components/resume/ActionMenu.tsx
      ├─ List: <ul class=list> <li aria-hidden header/> <ResumeRow|ProfileRow/>...
      └─ empty state (.empty)
   dialogs: ProfileNameDialog x2, DeleteProfileDialog, NewResumeDialog, actions.dialogs (Move, Keywords), locked.dialog

ProfilePage (Suspense)                                         app/admin/profiles/[profileId]/page.tsx:75
└─ ProfileBody (load / redirect / missing / failed)            :93
   └─ ProfileView                                              :178
      ├─ ‹ My Profiles back link, h1 name + rename pencil, "N resumes · Edited …", explain line, ⋮ (Rename/Delete profile), New resume
      ├─ .pageToolbar: Import resume ▾   <ViewToggle/>         (no search box on this page)
      ├─ Grid / List of ResumeCard / ResumeRow (profile=null)
      └─ empty state
```

Action logic for a resume's ⋮ is in `components/profiles/useResumeActions.tsx:88-288` (`itemsFor(resume)` + `dialogs`). Both pages share it.

---

## 2. The page frame around the views (context, VERIFIED code)

- Desk: `.editor { min-height: calc(100dvh - var(--tl-topbar-h)); background: var(--ed-desk); color: var(--ed-ink); }` (`resumeEditor.module.css:111-115`). `--tl-topbar-h: 4.5rem` (`app/globals.css:51`).
- `.page { max-width: 78rem; margin-inline: auto; padding: 2.5rem 1.5rem 4rem; }`. At 640px and below the padding is `1.5rem 1rem 3rem` (`resumePages.module.css:16-26`).
- `h1.title`: 2rem, weight 700, letter-spacing -0.02em, line-height 1.2. `.subtitle`: margin-top 0.5rem, 1rem, muted, line-height 1.5 (`resumePages.module.css:28-41`).
- Header row `.head`: flex, wrap, space-between, gap 1rem. `.headText` is `flex: 1 1 18rem`. `.headActions`: flex, wrap, gap 0.75rem. At 640px and below the actions take the full width and each child is `flex: 1 1 auto` (`profiles.module.css:15-33, 71-79`).
- Primary "Create New" `.createButton`: min-height 2.75rem, padding 0 1.25rem, radius 0.625rem, bg `--ed-primary`, text `--ed-primary-ink`, 0.9375rem/700, gap 0.5rem, 18px icon. Hover uses `--ed-primary-hover`. Disabled is opacity 0.55 with a not-allowed cursor. Focus ring: 2px `--ed-pink`, offset 2px (`profiles.module.css:42-69`).
- Outlined "Import" `.importButton`: min-height 2.75rem, padding 0 1.125rem, border 1.5px `--ed-ink`, radius 0.625rem, bg `--ed-card`, 0.9375rem/700. Hover uses `--ed-soft`. Disabled is opacity 0.6 with a progress cursor (`resumePages.module.css:474-501`).
- Tabs `.tabs`: flex, gap 0.25rem, margin-top 1.75rem, overflow-x auto, 1px bottom border `--ed-line`. `.tab`: min-height 2.75rem, padding 0 1rem, 3px transparent bottom border, muted, 1rem/700, nowrap. Selected: border `--ed-pink`, color `--ed-ink` (`profiles.module.css:93-127`).
- Notices area `.notices`: grid, gap 0.75rem, margin-top 1.5rem, hidden when empty (`resumePages.module.css:43-51`).

---

## 3. The Thumbnail (Grid) view in detail

### 3.1 Grid container and breakpoints (VERIFIED code: `resumePages.module.css:125-163`)

```css
.resumeGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 13.75rem), 1fr));
  gap: 2rem 1.5rem;            /* row 32px, column 24px */
  margin-top: 2rem;
}
@media (max-width: 640px) {    /* "Two up on a phone, as FlowCV's list is" */
  .resumeGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem 0.875rem; }
  .newTile { gap: 0.5rem; }  .newIcon { height: 2.75rem; width: 2.75rem; }
  .newLabel { font-size: 0.9375rem; }  .newHint { font-size: 0.8125rem; }
  .cardTitle { font-size: 0.9375rem; }  .cardMeta { font-size: 0.8125rem; }
}
```

Markup: `<ul className={css.resumeGrid}>`, then `<li><NewTile/></li>`, then one `<li key=id>` per card (`app/admin/profiles/page.tsx:483-503`, `[profileId]/page.tsx:367-383`).

**Computed card sizes** (INFERRED from the CSS above, at a 16px root, ignoring the scrollbar). A card's width is the grid track, its thumbnail height is `track × 1123/794`, and the iframe scale is `track/794`. free_tailor's shell has a fixed 16rem (256px) left sidebar from 768px up (`app/globals.css:52, 681-684, 1800-1806`). TailorIT, with a Simplify-style top header and no rail, gets the full width.

| Viewport (shell) | Page content width | Columns (incl. New tile) | Card width | Thumb height | Scale |
|---|---|---|---|---|---|
| 1440 free_tailor (256px rail) | 1136 | 4 | 266.0 | 376.2 | 0.335 |
| 1440 TailorIT (no rail; page capped at 78rem = 1248) | 1200 | 5 | 220.8 | 312.3 | 0.278 |
| 1024 TailorIT | 976 | 4 | 226.0 | 319.6 | 0.285 |
| 768 TailorIT | 720 | 3 | 224.0 | 316.8 | 0.282 |
| 700 TailorIT | 652 | 2 | 314.0 | 444.1 | 0.395 |
| 390 phone (2 columns forced, padding 1rem, column gap 14px) | 358 | 2 | 172.0 | 243.3 | 0.217 |

Note that between 641px and about 707px the auto-fill grid also lands on 2 columns, but the cards there are much larger than on a phone.

### 3.2 The dashed "New" tile (first grid cell)

VERIFIED (code): `NewResumeTile` at `ResumeCards.tsx:27-44`; `NewTile` at `ProfileCards.tsx:40-73`; CSS at `resumePages.module.css:166-218`.

```html
<button type="button" class="newTile" data-new-tile="resume" [disabled + title=reason while the page can't decide]>
  <span class="newIcon" aria-hidden="true"><IconPlus 28px stroke 2.4/></span>
  <span class="newLabel">New resume</span>
  <span class="newHint">Start from a template</span>
</button>
```

- `.newTile`: flex column, centred, gap 0.75rem, width 100%, `aspect-ratio: 794 / 1123` (the same size as a page), padding 1rem, border `2px dashed var(--ed-dash)`, radius 0.875rem, transparent background, colour `--ed-ink`, centred text. Hover (not disabled): border `--ed-pink` and bg `--ed-pink-soft`. Focus-visible: 2px pink outline with offset 3px. Disabled: opacity 0.55, not-allowed cursor.
- `.newIcon`: a 3.5rem circle with bg `--ed-gradient` (`linear-gradient(90deg, #ec008c 0%, #fc6767 100%)`), white icon and `--ed-gradient-shadow`. `.newLabel`: 1.0625rem/700. `.newHint`: 0.875rem, muted.
- On the Profiles tab the tile reads "New profile" / "A person you build resumes for". At the subscription limit it shows a lock icon and the hint `Needs <tier>`; it stays pressable and opens the lock dialog (`data-locked-feature="more-profiles"`, `aria-haspopup="dialog"`). The resume tile is **never** locked; it is only disabled while `blockedReason` is set (the dashboard passes "Checking your subscription..." while auth loads).
- The tile is drawn in Grid view only. List view has none: the header's Create New is the fallback focus target (`data-new-fallback`).
- Click: on the dashboard's All resumes tab, `newResume()` goes straight to the chooser when the account has exactly one profile and otherwise opens NewResumeDialog (`page.tsx:193-196`). On a profile page it goes to `newResumeHref(profile.id)`.

### 3.3 Resume card anatomy

VERIFIED (code): `ResumeCard` at `ResumeCards.tsx:205-265`; CSS at `resumePages.module.css:220-313` and `profiles.module.css:383-414`.

```html
<article class="card" data-resume-card="{id}">
  <div class="cardThumb" data-disabled="true|false">
    <div ref=box>                                   <!-- ResumeThumb: IntersectionObserver target -->
      <div class="thumb"> <iframe srcdoc=… sandbox="" aria-hidden tabindex=-1 scrolling=no …/> </div>   <!-- PageThumb -->
    </div>
    <a class="cover" href="/admin/resumes/{id}" aria-label="Edit {label}"></a>   <!-- link laid OVER the page: a frame may not sit inside a link -->
    <span class="thumbBadges">                     <!-- only when default or disabled -->
      <span class="badge badgeDefault" data-default-resume><IconStar 14px filled/>Default</span>
      <span class="badge">Disabled</span>
    </span>
  </div>
  <div class="cardFoot">
    <div class="cardText">
      <h2 class="cardTitle" title="{label}"><a href="/admin/resumes/{id}">{label}</a></h2>
      <p class="cardMeta" title="{profile.name}"><a class="profileLink" href="/admin/profiles/{pid}">{profile.name}</a></p>   <!-- All resumes tab only -->
      <p class="cardMeta">Edited 6 hours ago · {templateName}</p>
      <p class="cardWarning">The template this resume names is not offered any more, so it is drawn with {name}.</p>  <!-- rare -->
    </div>
    <ActionMenu triggerClassName="menuButton" triggerLabel="Actions for {label}" ⋮ />
  </div>
</article>
```

CSS values (VERIFIED code):

- `.card`: flex column, `min-width: 0`, gap 0.875rem.
- `.cardThumb`: relative, overflow hidden, radius 0.875rem, bg `#ffffff`, `box-shadow: var(--ed-card-shadow)`, transition transform/box-shadow 120ms. Hover: `box-shadow: var(--ed-card-shadow-hover); transform: translateY(-2px)`. Keyboard focus on the cover link: `.cardThumb:has(.cover:focus-visible) { outline: 2px solid var(--ed-pink); outline-offset: 3px; }`.
- `.cover`: `position:absolute; inset:0; z-index:1; display:block; border-radius:inherit`. Its own focus outline is removed because the ring is drawn on `.cardThumb`.
- `.cardThumb[data-disabled='true'] .thumb { opacity: 0.5 }`.
- `.cardFoot`: relative, flex, `align-items: flex-start`, space-between, gap 0.5rem. `.cardText` is `min-width:0; flex:1 1 auto`.
- `.cardTitle`: 1.0625rem/700, line-height 1.35, colour ink, single line with ellipsis; the link underlines on hover with a 2px offset.
- `.cardMeta`: margin-top 0.125rem, 0.875rem, muted, single line with ellipsis.
- `.cardWarning`: margin-top 0.375rem, 0.8125rem, line-height 1.4, `#b45309` (dark mode `#fbbf24`).
- `.menuButton` (⋮): a 2.25rem square, radius 0.5rem, `margin-top: -0.25rem`, muted. Hover and expanded: bg `--ed-card`, colour ink. Focus: 2px pink outline with offset 2px. The icon is `IconMoreVertical` at 20px with stroke 2.2.
- Overlay badges `.thumbBadges`: absolute at top/left 0.625rem, `z-index:2`, flex column, gap 0.375rem, `pointer-events:none`. `.badge`: pill, padding 0.25rem 0.625rem, 0.75rem/700, white text on `rgba(32,14,50,0.86)`, ellipsis. `.badgeDefault` uses `background: var(--ed-gradient)`.

The text lines (VERIFIED code):

- Label: `resumeLabel(resume)` is the headline (`title`) unless it is empty or `'Professional'`, else the person's `name`, else `'Untitled resume'`. Whitespace is tidied and NFC-normalised (`lib/profileDashboard.ts:92-96`).
- Edited line: `editedAgo(updatedAt, now)` (`lib/resumeGallery.ts:153-163`) gives `Edited just now` (under 1 min), `Edited N minute(s) ago`, `Edited N hour(s) ago`, or `Edited N day(s) ago` (under 7 days). After that it returns null, and the card prints `Edited ${new Date(updatedAt).toLocaleDateString()}` (`lib/format.ts:48`, via `editedLine` at `ResumeCards.tsx:178-180`). A time ahead of the clock reads "just now". The page has one clock, `now`, refreshed every `CLOCK_MS = 60_000` (`page.tsx:45, 139`), so every card moves together.
- Template name: `templateLine(templates, resume)` (`ResumeCards.tsx:165-175`) uses `drawnTemplate` (`lib/resumeDraft.ts:1064-1071`). The stored template is `preferredTemplate || 'default'`. If that template is not in the enabled list, the card shows the fallback's name and the warning. While the template list is empty (still loading or failed), the name is blank.

### 3.4 Profile card anatomy (Profiles tab; VERIFIED code `ProfileCards.tsx:95-139`)

This is the same `.card` / `.cardThumb` / `.cardFoot` skeleton:

- The thumbnail is the profile's **effective default resume's** first page: `<ResumeThumb resume={defaultResume} label="{name}, {resumeLabel}"/>`. With no resume it is a blank `PageThumb` with the placeholder "No resumes yet". `data-disabled` is always `"false"`.
- The cover link goes to `/admin/profiles/{id}`, with `aria-label="Open {name}, {N resumes}"`.
- Then the title link (name, or 'Untitled Profile'), a meta line `N resume(s)` and a meta line `Edited …` from `lastEditedAt`.
- The ⋮ menu offers Open, Rename, New resume, Delete (danger, with a rule before) (`profileMenuItems`, `ProfileCards.tsx:76-88`).

### 3.5 Thumbnail rendering technique (client)

VERIFIED (code): `PageThumb.tsx:1-87`, `ResumeThumb` at `ResumeCards.tsx:102-158`, CSS at `resumePages.module.css:68-121`.

**PageThumb** is generic: "One printed page, scaled down to the width of its box".

```tsx
export const PAGE_WIDTH_PX = 794;   // A4 at 96 dpi
export const PAGE_HEIGHT_PX = 1123;
// box = <div class="thumb"> ; ResizeObserver(box) → scale = box.clientWidth / 794
{hasPage && scale > 0 ? (
  <iframe key={src ?? 'srcdoc'} src={src} srcDoc={srcDoc} title={title}
          aria-hidden="true" tabIndex={-1} scrolling="no" loading={lazy ? 'lazy' : 'eager'}
          {...(srcDoc !== undefined ? { sandbox: '' } : {})}
          style={{ width: 794, height: 1123, transform: `scale(${scale})` }} />
) : placeholder}
```

```css
.thumb { position: relative; aspect-ratio: 794 / 1123; overflow: hidden; background: #ffffff; }
.thumb iframe { position: absolute; top: 0; left: 0; border: 0; background: #ffffff;
                transform-origin: 0 0; pointer-events: none; }
.thumbState { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
              padding:1rem; color:#8f959e; font-size:0.8125rem; text-align:center; }      /* "No preview" */
.thumbLoading { position:absolute; inset:0;
  background: linear-gradient(100deg, #ffffff 20%, #f4f4f6 40%, #ffffff 60%) 0 0 / 300% 100%;
  animation: thumb-shimmer 1.4s linear infinite; }                                       /* reduced-motion: none */
@keyframes thumb-shimmer { from { background-position: 100% 0 } to { background-position: 0 0 } }
```

Key properties:

- The page is laid out at its own printed size and scaled, never reflowed, "so a thumbnail is the page as it prints".
- Only the **first page** shows: the frame is 1123px tall and the box clips everything below it.
- The frame is drawn only once `scale > 0`, so a full-size frame never flashes.
- A resume's page uses `srcDoc` with **every sandbox flag off** (`sandbox=""`): no script, no same-origin access, no forms. The server's CSP meta is a second lock (§3.6). A template gallery page uses `src` instead, a cookie-authenticated GET on the API origin (`TemplateChooser.tsx:185-189`, `lib/api.ts:75-77 getApiOrigin`).
- The iframe is decorative to assistive tech (`aria-hidden`, `tabIndex=-1`, `pointer-events:none`). The card's cover link carries the accessible name.
- A new `src` is a new iframe (keyed by src) so the frame never adds browser-history entries. A `srcDoc` frame keeps a constant key.
- The thumbnail stays white in both themes ("they are the documents").
- `PageThumb` **ignores** the `page` size the server returns and hard-codes A4. Templates with another `@page size` are shrunk onto A4 by the server's chrome (§3.6), so this is consistent, but it is A4-only.

**ResumeThumb** handles lazy fetching and caching (`ResumeCards.tsx:46-158`):

```ts
const THUMB_CACHE_SIZE = 24;
const thumbPages = new Map<string, string>();               // key → html, insertion order = LRU
const thumbRequests = new Map<string, Promise<string>>();   // in-flight, shared by cards asking the same key
const thumbKey = (r) => `${r.id}:${r.updatedAt}`;           // a save = a new key = a fresh render
function loadThumb(r) {                                     // de-duplicates in-flight requests
  … resumesApi.preview({ resume: {}, resumeId: r.id, sample: false })
      .then(a => { rememberThumb(key, a.html); return a.html; })
      .finally(() => thumbRequests.delete(key));
}
// In the component:
//  - cache hit  → render immediately; an effect "touches" the key (moves it to newest)
//  - cache miss → IntersectionObserver(box, { rootMargin: '300px' }); first intersection → disconnect → loadThumb
//  - failure    → <ThumbState>No preview</ThumbState> for that key (no retry until updatedAt changes or the card remounts)
//  - while waiting → <ThumbLoading/> shimmer
```

The cache is module-level, so it survives switching tabs, toggling Grid/List (which unmounts every card) and client-side navigation between the dashboard and a profile page. It does not survive a reload. Eviction drops the oldest entries beyond 24; "the pages on screen are the last to go" because rendering touches them. VERIFIED (code).

### 3.6 Thumbnail rendering technique (server): how the page is produced

VERIFIED (code): `backend/src/routes/resumes.ts:191-268` and `backend/src/generators/pdfGenerator.ts`.

`POST /api/resumes/preview` (`requireUser`, router-level at `resumes.ts:49`). For a thumbnail the body is `{ "resume": {}, "resumeId": "<id>", "sample": false }`. The route then:

1. Reads `resumeId` and calls `getResumeFor(viewer, id)`. Another account's resume, or a missing one, is `404 {"error":"Resume not found"}` (`:230-235`).
2. An optional `templateId` must exist and be enabled (admins may request disabled ones), else 404 `Template not found` (`:238-245`). Thumbnails send none.
3. `buildPreviewResume(body.resume, existing)` (`services/resumeDocument.ts:779-842`). With an empty draft this yields the stored resume; only `technicalSkillsLayout`, `includeSoftSkills` and `includeStrengths` (`PREVIEW_SETTING_KEYS`, `:749-753`) could be overridden. It never throws.
4. `resolveTemplateForResume(draft)` picks the resume's `preferredTemplate`, else `default`, else the first enabled template, else `noTemplateAvailable()`.
5. `resumeForTemplate(draft, template)` turns off any section switch the template has no room for. Because `sample === false`, nothing is filled from the sample person (`sampled: []`). The editor's live preview, by contrast, fills empty fields from the sample person.
6. `generateResumeDraftPreviewHTML(shown, template)` (`pdfGenerator.ts:1988-2001`) does the following:
   - Runs `prepareResumeRenderData`, then the **Handlebars** template body (`renderTemplateBody`, `:1802-1814`), then prepends `<style>{template.cssContent}</style>` (`:1817-1819`).
   - `withPreviewContentSecurityPolicy` (`:1956-1962`) inserts `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` right **after** the doctype; putting it before the doctype would trigger quirks mode.
   - `previewPageChrome(resolveTemplatePageBox(template))` (`:1840-1902`) appends a `<style id="resume-preview-page">` that sets `html { width: {pageWidthPx}px; min-height: {pageHeightPx}px; background:#fff; padding: {@page margins}; clip-path: inset({margins}); print-color-adjust: exact }` and `body { width: {contentWidthPx}px !important; min-height: {contentHeightPx}px !important; margin-inline: auto !important }`. A template whose `@page size` is not A4 gets an extra `transform: translateY(…) scale(…)` to mirror Chrome shrinking it onto A4. Viewport units get a `body > * { min-height }` fix.
7. The answer is `200 { html, templateId, page: { widthPx, heightPx, contentHeightPx }, sampled: [] }`. The client type is `ResumeDraftPreviewResult` (`frontend/src/lib/api.ts:2031-2041`). The default A4 box is 794x1123 with fallback margins of 0.4in/0.5in/0.3in/0.5in (`pdfGenerator.ts:57-90`), but every built-in template declares its own `@page` margins.
8. Cost: no row is written, no model is called, no credit moves and no limit is checked.

**Server-side caching** (VERIFIED code):

- There is no cache of rendered HTML. Every thumbnail request re-reads the resume row, re-reads and parses the template JSON from disk (`readStaticTemplate`: `fs.readFile` plus `normalizeTemplateRecord`, `extractors/templateExtractor.ts:164-180`) and re-renders.
- Only the compiled Handlebars delegate is cached, in an LRU of `COMPILED_TEMPLATE_CACHE_SIZE = 128` (`pdfGenerator.ts:1618, 1675-1700`). Its key is `layout|soft|strengths|sectionOrder|customKeys|htmlContent`.
- Templates use system font stacks such as `Calibri, 'Segoe UI', Arial, sans-serif` in `backend/static/templates/default.json`. No template file loads web fonts, so the CSP's `font-src data:` costs nothing.

---

## 4. The List view in detail

### 4.1 Container and header row (VERIFIED code: `profiles.module.css:250-280`; `page.tsx:504-529`)

```html
<ul class="list">                                          <!-- grid, gap 0.5rem, margin-top 1.5rem -->
  <li class="listHead rowResume" aria-hidden="true">
    <span>Resume</span><span>Profile</span><span>Template</span><span>Edited</span><span/>
  </li>
  <li class="listRow rowResume" data-resume-row="{id}" data-disabled="true|false"> … </li>
</ul>
```

- `.listHead, .listRow`: `display:grid; align-items:center; gap:0.75rem 1rem; padding:0 1rem`.
- `.listHead`: colour `--ed-faint`, 0.75rem/700, letter-spacing 0.06em, uppercase.
- `.listRow`: min-height 3.5rem, padding-block 0.625rem, radius 0.75rem, bg `--ed-card`, `--ed-card-shadow`, colour ink, 0.9375rem. Each row is its own white rounded card; there are no table borders.
- `.listRow[data-disabled='true'] .cellMain { opacity: 0.6 }`.
- The `<ul>` is rendered only when the filtered list is non-empty, so a search with no matches draws no header (`shownResumes.length > 0 && (…)`).

### 4.2 Column templates per variant (VERIFIED code)

| Variant | Header labels (exact) | `grid-template-columns` | Source |
|---|---|---|---|
| Dashboard > All resumes (ResumeRow with `profile`) | `Resume`, `Profile`, `Template`, `Edited`, (blank) | `minmax(0, 2.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 10rem 2.5rem` (`.rowResume`, css:290-292) | `page.tsx:507-513` |
| Profile page (ResumeRow with `profile = null`) | `Resume`, `Name on resume`, `Template`, `Edited`, (blank) | same `.rowResume` | `[profileId]/page.tsx:387-393` |
| Dashboard > Profiles (ProfileRow) | `Profile`, `Resumes`, `Default resume`, `Edited`, (blank) | `minmax(0, 2.2fr) 6.5rem minmax(0, 2fr) 10rem 2.5rem` (`.rowProfile`, css:286-288) | `page.tsx:437-443` |

### 4.3 Row anatomy (VERIFIED code: `ResumeRow` at `ResumeCards.tsx:272-319`; `ProfileRow` at `ProfileCards.tsx:142-183`)

```html
<li class="listRow rowResume" data-resume-row="{id}" data-disabled="…">
  <div class="cellMain">                              <!-- flex, gap .625rem, weight 700 -->
    <a href="/admin/resumes/{id}" title="{label}">{label}</a>      <!-- ink, ellipsis, underline on hover -->
    <span class="badgeInline" data-default-resume><IconStar 14px filled/>Default</span>   <!-- pink-soft bg, pink text -->
    <span class="badgeInline">Disabled</span>                                        <!-- field bg, ink-2 -->
  </div>
  <div class="cell"><a class="profileLink" href="/admin/profiles/{pid}">{profile.name}</a> | {resume.name}</div>
  <div class="cell">{templateName}</div>               <!-- no "not offered" warning in a row -->
  <div class="cell">{Edited …}</div>
  <div class="cellMenu"><ActionMenu triggerClassName="rowMenuButton" triggerLabel="Actions for {label}" ⋮/></div>
</li>
```

- `.cell`: `min-width:0`, overflow hidden, colour `--ed-ink-2`, ellipsis, nowrap. `.cellMain a`: same truncation, colour ink. `.cellMenu`: flex, justify-end.
- `.rowMenuButton`: a 2.25rem square, radius 0.5rem, muted. Hover and expanded: bg `--ed-soft`, ink. Pink focus ring (`profiles.module.css:330-350`).
- `.badgeInline`: inline-flex, padding 0.125rem 0.5rem, pill, bg `--ed-field`, colour `--ed-ink-2`, 0.75rem/700. The `[data-default-resume]` badge uses bg `--ed-pink-soft` and colour `--ed-pink` (`:417-433`).
- In a ProfileRow the default-resume cell is `<span class="starLabel"><IconStar 16px filled pink/>{label}</span>`, or the text `No default yet`.

### 4.4 Phone layout of the list (VERIFIED code: `profiles.module.css:356-379`)

```css
@media (max-width: 640px) {
  .listHead { display: none; }
  .rowProfile, .rowResume { grid-template-columns: minmax(0, 1fr) 2.5rem; gap: 0.25rem 0.5rem; }
  .rowProfile > .cell, .rowResume > .cell { grid-column: 1; font-size: 0.8125rem; }   /* cells stack under the name */
  .rowProfile > .cellMenu, .rowResume > .cellMenu { grid-column: 2; grid-row: 1 / span 4; align-self: start; }
}
```

The e2e test at 390px checks that there is no sideways scroll, every ⋮ is inside the window, and an open menu stays inside the window (`backend/test/e2e/profiles.js:1187-1201`).

---

## 5. Shared controls

### 5.1 Grid | List toggle and how the view persists

VERIFIED (code): `ViewToggle.tsx:1-67`, `lib/profileDashboard.ts:29-50`, CSS at `profiles.module.css:200-246`, test at `backend/test/frontendProfiles.test.js:182-210`.

```html
<div class="viewToggle">                                  <!-- inline-flex, gap .5rem, margin-left:auto -->
  <span class="viewLabel" aria-hidden="true">View:</span> <!-- .875rem/600 muted -->
  <div role="group" aria-label="View" class="viewButtons"><!-- padding .1875rem, radius .625rem, bg card, card shadow -->
    <button class="viewButton" aria-pressed="true|false" aria-label="Grid" title="Grid"><IconGrid 18px/></button>
    <button class="viewButton" aria-pressed="…" aria-label="List" title="List"><IconList 18px/></button>
  </div>
</div>
```

- `.viewButton`: 2.25rem tall, 2.5rem wide, radius 0.5rem, muted. Pressed: bg `--ed-primary`, colour `--ed-primary-ink`. Hover (not pressed): bg `--ed-soft`, ink. Pink focus ring.
- Persistence: `useViewMode()` reads `localStorage.getItem('freeTailor.profiles.view')` once, in the lazy `useState` initialiser, never in an effect. AuthGate mounts pages on the client only, so there is no SSR first paint to mismatch. Every change writes the key.
- `readViewMode` returns `'list'` only for the exact string `'list'`. `''`, `'LIST'`, `' list'`, `'cards'`, a missing key, a null storage and a throwing storage all read `'grid'`, and every access is in try/catch (pinned by the test above).
- **One key for every page**: "the view is the person's, not the page's" (`profileDashboard.ts:31-32`). The Profiles tab, the All resumes tab and every profile page share it.
- Toggling unmounts every card. Thumbnails come back from the module cache with no new requests (§3.5).
- The dashboard tab is persisted in the URL: `router.replace(dashboardHref(tab), { scroll: false })`. `?tab=resumes` selects All resumes; anything else, including `?tab=garbage`, reads as Profiles (`profileDashboard.ts:18-25`; e2e at `profiles.js:744-794`).

### 5.2 Search box and status line

VERIFIED (code): `SearchBox.tsx:13-56`, `profileDashboard.ts:108-175`, CSS at `profiles.module.css:131-198`.

```html
<div class="searchRow">                                   <!-- flex 1 1 16rem; max-width 30rem; gap .5rem -->
  <div class="searchBox">                                 <!-- relative -->
    <IconSearch class="searchIcon"/>                      <!-- absolute left .75rem, faint, pointer-events none -->
    <input id="resumes-search" type="search" class="tl-input" placeholder="Search resumes"
           aria-label="Search resumes" autocomplete="off"/>   <!-- padding-left 2.5rem -->
  </div>
  <button type="button" class="clearButton">Clear</button>  <!-- only while value !== '' ; refocuses the input -->
</div>
<p class="matchStatus" role="status">1 of 3 resumes match.</p>   <!-- always mounted; :empty → display:none -->
```

- Ids and labels: `profiles-search` / "Search profiles" and `resumes-search` / "Search resumes". **The profile page has no search box.**
- Inside the desk, `.tl-input` is a grey borderless field: min-height 2.875rem, padding 0.625rem 0.875rem, radius 0.625rem, bg `--ed-field`, 1rem. Hover uses `--ed-field-hover`. Focus: border `--ed-pink`, bg `--ed-card`, `box-shadow: 0 0 0 3px var(--ed-pink-ring)` (`resumeEditor.module.css:435-483`).
- Matching (`matchesQuery`): the query is tidied (NFC, whitespace collapsed, trimmed) and lower-cased, then tested as a substring of any field. An empty query matches everything. It filters on every keystroke with no debounce.
- Fields: a resume matches on `resumeLabel(resume)`, `resume.name` or its profile's name. A profile matches on its name or the label or name of any of its resumes.
- Status line text: `describeMatches(shown, total, noun)` gives `` `${shown} of ${total} ${noun}${total === 1 ? '' : 's'} match.` `` (for example `0 of 2 profiles match.`). It is shown only while the query is non-blank.
- The query is per tab, held in component state; it is not in the URL and is not persisted.

### 5.3 Sort (fixed; there is no sort control)

VERIFIED (code):

- All resumes: `sortResumes` (`page.tsx:53-59`), newest `updatedAt` first, ties by ascending id. Unparseable dates fall through to the id.
- Profile page: `orderResumes` (`[profileId]/page.tsx:51-59`) puts the effective default resume first, then newest `updatedAt`, then id.
- Profiles: `sortProfiles` (`profileDashboard.ts:137-143`), newest `lastEditedAt` first, then id.
- The server's `DocumentTable.list` already orders by `updated_at DESC, id ASC` (`backend/src/database/documentTable.ts:41-46`); the client re-sorts so the order "never depends on the order the server answered in".
- A Move keeps `updatedAt`, so moving a resume does not reorder it.

### 5.4 Filters, pagination, selection

VERIFIED (code): there are **none**. There are no status or template filters (filter pills exist only in the template chooser), no pagination or "load more", no virtualization (every matching card is mounted) and no checkboxes or bulk actions. `MoveResumesDialog` can take several resumes (title "Move N resumes"), but the pages pass only one.

### 5.5 The ⋮ ActionMenu (generic)

VERIFIED (code): `ActionMenu.tsx:1-180`, CSS at `resumePages.module.css:315-426`.

- Item shape: `ActionMenuItem { key, label, hint?, icon?, tone?: 'danger', disabled?, title?, ruleBefore?, onSelect }`.
- Trigger: `<button aria-haspopup="menu" aria-expanded aria-controls={open?menuId} aria-label={triggerLabel} title>`.
- Menu: `<div role="menu" aria-label data-placement="below|above" data-align="end|start">`. Each item is wrapped as `<div role="none">`, with an optional `<div class="menuRule" role="separator"/>` before it and a `<button role="menuitem" data-tone>` inside.
- Placement is measured once, on open, with no double render. The estimated height is `12 + Σ(hint ? 62 : 42) + 13 per ruleBefore`. It opens **above** if `below < height + 8 && rect.top > below`. It aligns from the button's **right** edge unless there is no room leftwards for `MENU_MIN_WIDTH_PX = 216` (+8) but there is rightwards, in which case it aligns from the left (`data-align="start"`).
- Keyboard:
  - Opening (click, Enter or Space) focuses the first enabled item.
  - ArrowDown and ArrowUp cycle with wrap. Home and End jump to the ends.
  - Escape closes the menu and focuses the trigger.
  - Tab closes it.
  - An outside `mousedown` closes it, and so does a document-level Escape (`lib/useDismissable.ts`).
  - Choosing an item closes the menu, **focuses the trigger first, then runs `onSelect`**, so a dialog it opens returns focus to the ⋮ (e2e `profiles.js:903-905, 957-959, 1001-1003`).
  - There is no type-ahead, and ArrowDown on the closed trigger does nothing.
- CSS:
  - `.menu`: absolute, `top: calc(100% + .375rem); right: 0`, `z-index: var(--layer-page-overlay)` (200, `globals.css:65`), min-width 13.5rem, `max-width: calc(100vw - 2rem)`, padding 0.375rem, radius 0.75rem, bg card. Shadow: `0 0 0 1px rgba(32,14,50,.06), 0 18px 36px -14px rgba(32,14,50,.35)`; dark mode uses `0 0 0 1px rgba(148,163,184,.16), 0 18px 36px -14px rgba(0,0,0,.7)`.
  - `.menuItem`: flex, gap 0.75rem, padding 0.625rem 0.75rem, radius 0.5rem, 0.9375rem/500, nowrap. Hover and focus-visible: bg `--ed-soft`. Disabled: opacity 0.5. Danger: colour `--ed-danger`.
  - Icon: 18px, stroke 2, muted. A danger item's icon takes `currentColor`.
  - `.menuHint`: 0.8125rem, muted, wraps. `.menuRule`: 1px `--ed-line`, margin 0.375rem 0.25rem.

### 5.6 A resume's ⋮ items (exact labels, rules, calls, notices)

VERIFIED (code): `useResumeActions.tsx:212-262`. The order is pinned by e2e at `profiles.js:896-902`.

| # | Label | Icon | Enabled when / tooltip (`title`) | What it does | Success notice |
|---|---|---|---|---|---|
| 1 | `Edit` | Pencil | always | `router.push('/admin/resumes/{id}')` | - |
| 2 | `Set as default` | Star | disabled if there is no profile, the resume is disabled, or it is already the chosen default. Tooltip: `This resume is not in a profile yet.` / `Enable this resume first: a disabled resume cannot be the default.` / `Already the default resume.` / `Fully Tailor builds the default resume` | `PUT /api/profiles/{pid} {defaultResumeId}`, then reload | `{label} is now {profile}'s default resume.` |
| 3 | `Duplicate` | Copy | always. A ref guard allows one copy per press. | `GET /api/resume/models`, then `POST /api/resumes?profileId={pid}` with `duplicateResumeBody` (everything except id, times, `disabled`, `profileId`, `matchKeywords`; keeps the template; model passed through `savableModelChoice`); then reload plus `/auth/me` | `Duplicated {label} in {profile}. Change its headline in its editor to tell them apart.` |
| 4 | `Move to another profile...` | Folder | always | opens MoveResumesDialog: `POST /api/profiles/{target}/move {resumeIds:[id]}`, or `POST /api/profiles {name, resumeIds:[id]}` for "A new profile" (locked at the limit) | `Moved {label} to {target}.` |
| 5 | `Keywords` | Text | tooltip `The job titles and skills this resume is matched on` | opens KeywordsDialog, which reads `resume.matchKeywords` (no call) | - |
| 6 | `Download JSON` | Download | tooltip `The resume as a file that Import takes back` | client-side Blob plus a hidden `<a download>`. File name is `resumeExportFileName` (lower-case, hyphenated, at most 60 chars, `.json`). Content is the resume minus `profileId` and `matchKeywords`. | - |
| 7 | `Disable` / `Enable` | EyeOff / Eye | `Disable` has tooltip `Kept, but left out of Build Resumes` | `PUT /api/resumes/{id} {disabled: !disabled}`, then reload | - |
| 8 | `Delete` | Trash, danger, rule before | always | **native `window.confirm("Delete {label}? This can't be undone.")`**, then `DELETE /api/resumes/{id}`, then reload plus `/auth/me`, then focus moves to the neighbouring card | `Deleted {label}.` |

Error handling: `attempt()` clears the notice and error, runs the call, and sends a 402 `profile-limit` to the lock dialog. Anything else goes to `onError` (a dismissable ErrorNotice). For a 404 or 409 (`isStaleRefusal`) it also reloads both lists so a dead card cannot keep failing. Fallback sentences: `Failed to set the default resume.`, `Failed to duplicate the resume.`, `Failed to update the resume.`, `Failed to delete the resume.`.

### 5.7 Focus after a card leaves

VERIFIED (code): `focusAfterRemoval.ts:1-53`.

`neighbourOf(visibleIds, [removedId])` picks the next id, else the previous one. `focusCard(kind, id)` waits two animation frames for the re-render, then focuses `[data-${kind}-card="id"] a[href]` or `[data-${kind}-row="id"] a[href]`. If neither exists it falls back to `[data-new-tile="${kind}"]`, then to `[data-new-fallback="${kind}"]` (the header's Create New, because List view has no tile). It is used after Delete, after a Move out of a profile page (`leavesOnMove`) and after a profile is deleted. `CardKind = 'profile' | 'resume'`.

---

## 6. States and their exact copy

VERIFIED (code).

| State | Dashboard (`page.tsx`) | Profile page (`[profileId]/page.tsx`) |
|---|---|---|
| Route suspense and first load | `<Spinner label="Loading profiles..."/>` on the desk (`:81-92, 234-242`). There are no skeleton cards for resumes; the template chooser uses 6 shimmer cards. | `<Spinner label="Loading the profile..."/>` (`:79, 141-147`) |
| First load failed | `ErrorNotice fallback="Could not load your profiles"` plus a quiet **Try again** button. It never draws "0 profiles" (`:246-267`). | `ErrorNotice fallback="Could not load this profile"` plus a `Back to My Profiles` link (`:149-160`) |
| Not found | - | warn `Notice`: `That profile was not found. It may have been deleted.` plus `Back to My Profiles`. A 404 first tries `GET /api/resumes/{id}` and redirects to the editor for old bookmarks (`:112-139, 162-173`). |
| Empty (no items at all) | `.empty` block: `No resumes yet` / `Add a resume to one of your profiles.`; Profiles tab: `No profiles yet` / `A profile is a person you build resumes for. Create one, then add their resumes.` A button (`New resume` / `Create profile`) appears **only in List view**; in Grid the New tile is the call to action (`:457-471, 532-544`). | `No resumes in this profile yet.` / `Start one from a template, or import a resume PDF or JSON file.` plus `New resume` in List view only (`:408-420`) |
| Search matches nothing | Only the status line `0 of N resumes match.`. Grid still shows the New tile; List shows nothing (no header). | - (no search) |
| Thumbnail loading / failed / no resume | shimmer / `No preview` / `No resumes yet` (profile card) | same |
| Template list failed | silently ignored: template names are blank (`templatesApi.getAll().then(setTemplates, () => undefined)`) | same |
| Import busy | `<p role="status">` with spinner: `Reading your resume. This can take a minute.` (PDF) / `Importing your resumes...` (JSON) | same, inline in the toolbar |
| Action success | green `Notice tone="success"` in `.notices`: the messages in §5.6, plus `Renamed the profile to {name}.`, `Deleted {name} and its resumes.`, `Imported {label} as a new resume.`, `Imported N resume(s) and made the profile(s) A, B.` | same; imports read `… into {name}.` |
| Action error | dismissable `ErrorNotice` (×) with a profile-limit link when relevant | same |
| Disabled default | - | warn Notice: `{label} is disabled, so Fully Tailor builds {other} until it is enabled.` / `Every resume in this profile is disabled, so it cannot be built until one is enabled.` |

Empty-state CSS (`profiles.module.css:449-479`): `.empty` is a grid with centred items, gap 0.5rem, margin-top 2rem, padding 3rem 1.5rem, `border: 2px dashed var(--ed-dash)`, radius 0.875rem, centred text. `.emptyTitle` is 1.125rem/700 ink. `.emptyBody` is max-width 28rem, 0.9375rem, muted, line-height 1.5.

A flash notice crosses one navigation through `sessionStorage['freeTailor.profiles.flash']` (`flashNotice.ts`): a profile deleted on its own page sends the user to the dashboard, which says `Deleted {name} and its resumes.`. The value is peeked in an initialiser and cleared in an effect.

---

## 7. Keyboard and accessibility summary

VERIFIED (code), except where marked.

| Element | Behaviour |
|---|---|
| Tabs | `role=tablist aria-label="Profiles and resumes"`; `role=tab` with `id`, `aria-selected`, `aria-controls` and a roving `tabIndex` (0/-1). ArrowLeft and ArrowRight wrap; Home and End go to the ends. Selection follows focus (automatic activation), and the new tab is focused on the next animation frame. `role=tabpanel aria-labelledby`. Focus ring is drawn inside (`outline-offset:-2px`). |
| Grid card | Tab stops per card: cover link (`aria-label="Edit {label}"`, ring on `.cardThumb` via `:has()`), then title link, then profile link (when present), then the ⋮ button (`aria-label="Actions for {label}"`). The iframe is `aria-hidden` and `tabIndex=-1`. Cards are `<article>` with an `<h2>` title, inside `<ul><li>`. |
| List row | Tab stops: name link, then profile link, then ⋮. **The header row is `aria-hidden` and rows are `li > div` cells, so a screen-reader user gets no column names** (INFERRED weakness). |
| View toggle | `role=group aria-label="View"`; two buttons with `aria-pressed` and `aria-label` "Grid" / "List". The "View:" text is `aria-hidden`. |
| Search | `type=search` with `aria-label` equal to the placeholder. The live region `role=status` always stays mounted. Clear returns focus to the input. |
| ⋮ menu | ARIA menu pattern (§5.5). Focus returns to the trigger on Escape and on item select. |
| Dialogs | kit `Dialog`: portalled to `<body>`, `role=dialog aria-modal`, Escape closes the top dialog only (dialog stack), backdrop mousedown closes it, the page scroll is locked, and focus goes back to the opener recorded at mount. |
| After removal | focus moves to the neighbour card, then the New tile, then Create New (§5.7). |
| Focus rings | 2px solid `--ed-pink`, offset 2px (3px on tiles and thumbnails). |
| Motion | the shimmer stops under `prefers-reduced-motion: reduce`. |
| Tooltips | native `title` on the ⋮ items, the view buttons, the Import trigger (`Read a resume PDF or a resume JSON file; each resume is filed under its person`) and the truncated title links. |

---

## 8. Responsive breakpoints (VERIFIED code)

| Breakpoint | Effect |
|---|---|
| any width | the grid auto-fills tracks of at least 13.75rem (220px); the page is capped at 78rem |
| `max-width: 640px` | page padding 1.5rem 1rem 3rem; grid forced to 2 columns, gap 1.5rem/0.875rem; New tile and card text shrink; header actions go full width and stretch; list header hidden and rows stack (§4.4) |
| `max-width: 767.98px` | free_tailor shell only: the sidebar becomes a drawer. Not relevant to TailorIT's header layout. |
| Menus | flip above or below and start or end by measurement; `max-width: calc(100vw - 2rem)` |

---

## 9. Data each view needs, and the API calls

### 9.1 Loads per page (VERIFIED code)

**Dashboard** (`page.tsx:122-141`). These calls run in parallel on mount:

| Call | Answer | Used for |
|---|---|---|
| `GET /api/profiles` (`profilesApi.getAll`, `lib/api.ts:2517-2520`) | `ProfileSummary[]` = `{ id, name, ownerId?, createdAt, updatedAt, lastEditedAt, resumeCount, enabledResumeCount, defaultResumeId, chosenDefaultResumeId }` (`api.ts:1954-1969`), normalised leniently (`:2489-2508`) | tab counts, profile cards and rows, the profile name and link on resume cards, the ★ (`profile.defaultResumeId === resume.id`), Set-as-default rules, Move targets, the limit |
| `GET /api/resumes?includeDisabled=true` (`resumesApi.getAll`, `:2316-2319`) | `Resume[]`: **full documents** (contact, summary, experience, education, skills, sections…) plus the derived `matchKeywords` and `profileId` (`api.ts:1893-1947`) | resume cards and rows (`id, title, name, updatedAt, disabled, preferredTemplate, profileId`), the profile-card thumbnail of the default resume, Duplicate and Download (need the full document), Keywords (need `matchKeywords`) |
| `GET /api/templates` (`templatesApi.getAll`, `:2566-2569`) | `Template[]` (enabled only): **full records including `htmlContent` and `cssContent`** (the built-ins are 3-17 KB each, 27 files in `backend/static/templates`) | only the template **name** on each card and row; failure ignored |
| `GET /auth/me` (AuthContext, shell-wide) | account (role, subscription, `profileLimit`, `profilesUsed`, `uploadMaxMb`) | usage line, lock, upload cap |

**Profile page** (`[profileId]/page.tsx:99-110`):

- `GET /api/profiles/{id}`. A 404 triggers the bookmark fallback `GET /api/resumes/{id}`.
- `GET /api/profiles` for the Move targets (a failure becomes `[]`).
- `GET /api/resumes?includeDisabled=true`, **filtered client-side by `profileId`**, so the page downloads every resume of the account.
- `GET /api/templates`.

**Per grid card, lazily:** `POST /api/resumes/preview` with body `{"resume":{},"resumeId":"<id>","sample":false}`, answering `{ html, templateId, page:{widthPx,heightPx,contentHeightPx}, sampled:[] }` (§3.6). A profile card requests its default resume's page under the same cache key as that resume's own card.

### 9.2 Backend list endpoints (VERIFIED code)

- `GET /api/resumes` (`backend/src/routes/resumes.ts:98-109`):
  - Router-level `requireUser`.
  - First files the viewer's old unfiled resumes (`fileUnfiledResumesFor`, a cheap read when there is nothing to file).
  - `?includeDisabled=true` includes disabled resumes. `?allOwners=true` is honoured for admins only.
  - Answers `listResumesFor(viewer, opts).map(withMatchKeywords)`; `matchKeywords` is **computed on every read** (`:88-95`).
  - `listResumesFor` (`database/resumeRepository.ts:84-92`) calls `resumes.list()`, which loads **every resume of every account**, then filters `ownerId === viewer.id` in JavaScript.
- `GET /api/resumes/:id`: same filing and keywords; another account's resume is 404, not 403.
- `GET /api/profiles` (`routes/profiles.ts:65-71`): `listProfileSummariesFor`, with counts from one `GROUP BY profile_id` query, newest edit first (CLAUDE.md 2109-2119).
- Storage: `DocumentTable` stores one JSON `data` column plus indexed columns. `resumes(id, name, disabled, data, created_at, updated_at, owner_id, profile_id)` (`backend/src/database/sqlite.ts:59-68`).

### 9.3 Action calls

The calls are listed in §5.6, plus these:

- Profile ⋮: Rename `PUT /api/profiles/{id} {name}`; Delete `DELETE /api/profiles/{id}`, answering `{deleted:true, deletedResumes}` (deletes every resume in the profile). New profile `POST /api/profiles {name}`, which counts the limit and may answer 402 `profile-limit`.
- Import: `POST /api/resumes/upload[?profileId=]` (multipart field `resume`, an AI extraction) and `POST /api/resumes/import[?profileId=]` (a parsed JSON body). The import answers 201 `{ resumes, imported, keptIds, profileIds, createdProfiles:[{id,name}] }`.
- After most mutations the page calls `load()` again (both lists), and often `refresh()` (`/auth/me`) as well. There is no optimistic update.

---

## 10. Design tokens and the CSS that defines the look

VERIFIED (code): tokens are declared on `.editor, .tokens` (`frontend/src/components/resume/resumeEditor.module.css:28-66`) and restated for `html.dark` (`:73-106`). Every rule in `profiles.module.css` and `resumePages.module.css` reads these variables. The font is DM Sans via `next/font/google` as `--font-editor` (`components/resume/editorFont.ts`), with fallback `var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif`.

| Token | Light | Dark | Role in these views |
|---|---|---|---|
| `--ed-desk` | `#f3f1ec` | `#0a1220` | page background ("warm desk") |
| `--ed-card` | `#ffffff` | `#111c2f` | list rows, menus, view toggle, Import bg |
| `--ed-card-shadow` | `0 0 0 1px rgba(32,14,50,.04), 0 1px 3px rgba(32,14,50,.05)` | `0 0 0 1px rgba(148,163,184,.1)` | thumbnails, rows, toggle |
| `--ed-card-shadow-hover` | `0 0 0 1px rgba(32,14,50,.05), 0 12px 28px -16px rgba(32,14,50,.24)` | `0 0 0 1px rgba(148,163,184,.16), 0 12px 28px -16px rgba(0,0,0,.6)` | thumbnail hover |
| `--ed-ink` | `#200e32` | `#eef2fb` | titles, names, Import border |
| `--ed-ink-2` | `#374151` | `#c6d1e3` | list cells, inline badges |
| `--ed-muted` | `#6b7280` | `#9aa8c0` | meta lines, hints, ⋮ |
| `--ed-faint` | `#8f959e` | `#7d8ba6` | list header, search icon, placeholder |
| `--ed-line` | `#e5e7eb` | `#25334d` | tab underline, menu rule |
| `--ed-dash` | `#d6d9de` | `#33435f` | New tile and empty-state dashed border |
| `--ed-field` | `#f3f4f6` | `#18253b` | search input, inline badge bg |
| `--ed-soft` | `#f7f8f9` | `#172439` | hover bg (menu items, toggle, rows' ⋮) |
| `--ed-pink` | `#ec058a` | `#ff5aa8` | focus rings, selected tab, ★ default inline |
| `--ed-pink-soft` | `#fdf0f7` | `rgba(236,0,140,.16)` | New tile hover, inline Default badge |
| `--ed-pink-ring` | `rgba(236,5,138,.2)` | `rgba(255,90,168,.3)` | input focus halo |
| `--ed-gradient` | `linear-gradient(90deg, #ec008c 0%, #fc6767 100%)` | (same) | New tile icon, overlay Default badge |
| `--ed-gradient-shadow` | `0 10px 24px -12px rgba(236,0,140,.6)` | `… rgba(236,0,140,.45)` | New tile icon |
| `--ed-primary` / `-hover` / `-ink` | `#200e32` / `#35184f` / `#ffffff` | `#f3effa` / `#ffffff` / `#200e32` | Create New, pressed view button |
| `--ed-violet-soft` / `--ed-violet-ink` | `#f1edff` / `#5a2fe4` | `rgba(124,92,255,.2)` / `#c7b8ff` | keyword chips (job titles) |
| `--ed-danger` | `#b91c1c` | `#fca5a5` | Delete item |

Hard-coded literals in the two view stylesheets (VERIFIED by grep):

- `profiles.module.css:404-405`: overlay badge `rgba(32,14,50,.86)` with `#ffffff` text.
- `resumePages.module.css`:
  - white page `#ffffff` at `:75, 83, 232`.
  - `#8f959e` "No preview" text (`:96`).
  - shimmer `#ffffff` / `#f4f4f6` (`:104`).
  - New-icon `#fff` (`:206`).
  - template warning `#b45309` (dark mode `#fbbf24`) (`:306, 312`).
  - menu shadows (`:355, 370`).
  - chooser-only literals at `:516-609`.

Re-skinning to Simplify therefore means swapping the token block, the about 10 literals above and the font; no markup changes are needed (INFERRED). Simplify's actual values come from the simplify-design report (UNKNOWN here).

Shared kit pieces these views use (VERIFIED code, `app/globals.css`):

- `.tl-button` (`:804-831`) and `.tl-button-quiet` (`:833-863`), restyled inside the desk at `resumeEditor.module.css:550-578`.
- `.tl-notice[data-tone]` (`:1074-…`), `.tl-spinner` (`:1324-1344`, 1.25rem ring, 0.8s spin) and `.tl-backdrop` / `.tl-dialog`.
- The z-index layers `--layer-page-overlay: 200` and `--layer-app-modal: 1200` (`:63-72`).
- Icons come from the hand-rolled set `components/icons/index.tsx`: a 24x24 grid, stroke 1.75, round caps, `currentColor`. The views use IconGrid, IconList, IconMoreVertical, IconStar, IconPlus, IconFolder, IconPencil, IconTrash, IconCopy, IconDownload, IconEye, IconEyeOff, IconText, IconUpload, IconLock and IconSearch. Their exact path data is at `index.tsx:99-104, 236-292, 337-341, 386-407, 468-513`.
- Tailwind 4 utilities appear only for icon sizes (`h-[18px] w-[18px]`, `h-5 w-5`, `h-7 w-7`) and a few spacing classes (`space-y-4`, `mt-1`, `font-semibold`, `underline underline-offset-2`).

---

## 11. Port inventory for TailorIT

### 11.1 Port as-is: already generic (rename the tokens and the storage keys)

| File | Lines | Notes |
|---|---|---|
| `frontend/src/components/resume/PageThumb.tsx` | 87 | Generic scaled-page frame. Recommended change: accept `page = {widthPx, heightPx}` (the server already returns it) instead of the A4 constants, and set the box's `aspect-ratio` from it, so US Letter works. |
| `frontend/src/components/resume/ActionMenu.tsx` | 180 | Generic menu. Depends on `lib/useDismissable.ts` (48 lines) and `resumePages.module.css` `.menu*`. |
| `frontend/src/components/profiles/SearchBox.tsx` | 56 | Generic. |
| `frontend/src/components/profiles/ViewToggle.tsx` | 67 | Generic UI. Change `useViewMode()` to `useViewMode(storageKey)`. |
| `frontend/src/components/profiles/focusAfterRemoval.ts` | 53 | Widen `CardKind` to `'resume' \| 'cover-letter' \| …`. |
| `frontend/src/components/profiles/flashNotice.ts` | 44 | Rename the key. |
| `frontend/src/lib/profileDashboard.ts` | 184 | Keep `readViewMode`/`writeViewMode` (parametrize the key), `matchesQuery`, `describeMatches` (parametrize the noun), `resumeLabel`. Tabs, addresses and profile helpers depend on the profile decision. |
| `frontend/src/lib/resumeGallery.ts` | 207 | Keep `editedAgo` (generic). `duplicateResumeBody`, `resumeExportFileName` and `resumeExportText` are resume-only. |
| `frontend/src/lib/useDismissable.ts` | 48 | Generic. |
| `frontend/src/components/ui/kit.tsx` (Notice, ErrorNotice, Spinner) and `components/ui/Dialog.tsx` + `lib/dialogStack.ts` + `lib/userMessage.ts` | 369 / 181 / 72 / 144 | Generic kit. ErrorNotice's "Contact admin" link is free_tailor-specific. |
| `frontend/src/components/icons/index.tsx` (16 icons + the `Icon` wrapper) | 597 | Or swap for Simplify-like icons. |

### 11.2 Port and adapt

| File | Lines | Adaptation |
|---|---|---|
| `frontend/src/components/resume/ResumeCards.tsx` | 337 | Split it into a generic `DocumentThumb` (the cache and lazy loader, with the key prefixed by kind) plus a generic `DocumentCard` / `DocumentRow`. `ResumeCard` / `ResumeRow` become thin adapters. Keep `saveTextFile` and `resumeEditorHref`. |
| `frontend/src/components/profiles/ProfileCards.tsx` | 183 | Make `NewTile` generic (`kind`, `label`, `hint`, optional lock). `ProfileCard` / `ProfileRow` only if profiles are kept. |
| `frontend/src/components/profiles/useResumeActions.tsx` | 288 | This is the resume menu adapter. Remove or keep the profile-dependent items (Set as default, Move) per the decision. Replace `window.confirm` with a styled dialog. Drop `useProfileLimit` without subscriptions. |
| `frontend/src/components/profiles/profiles.module.css` | 655 | Keep: header, createButton, working, tabs, controls, search, matchStatus, viewToggle, list, cells, rowMenuButton, badges, empty states. Drive `.rowResume`-style tracks from a CSS variable per kind (§12.2). Drop dialogs, chips and profile-page rules if unused. |
| `frontend/src/components/resume/resumePages.module.css` | 868 | Keep: `.page`, `.title`, `.subtitle`, `.notices`, `.back`, `.thumb*`, `.resumeGrid`, `.newTile*`, `.card*`, `.cover`, `.menu*`, `.importButton`. Lines 428-868 belong to the chooser, the details dialog and the import dialog; they go with the new-resume flow, not with these views. |
| `frontend/src/components/resume/resumeEditor.module.css` | 1804 | Only the token block (`:28-106`), `.editor` (`:111-115`) and the `.tl-*` restyles (`:427-590`) concern these views. Replace the values with Simplify tokens. |
| `frontend/src/components/resume/editorFont.ts` | 17 | DM Sans. Replace with Simplify's typeface per simplify-design. |
| `frontend/src/app/admin/profiles/page.tsx` and `[profileId]/page.tsx` | 609 / 451 | Reference implementations of the page wiring (load, notices, tabs, the grid/list switch, empty states). TailorIT's Documents page re-composes them. |
| `frontend/src/components/resume/useResumeImport.ts` | 125 | If Import stays: PDF upload (AI) and JSON import. Its `profileId` handling depends on the profile decision. |
| `backend/src/routes/resumes.ts` | 404 | GET /, GET /:id, POST /, PUT /:id, DELETE /:id, POST /preview (and import/upload if kept). Replace `listResumesFor`'s JS filter with `WHERE owner_id = ?`. |
| `backend/src/generators/pdfGenerator.ts` (preview part) | `:1802-2001` plus the render pipeline | `generateResumeDraftPreviewHTML`, `previewPageChrome`, `resolveTemplatePageBox`, `withPreviewContentSecurityPolicy`, `PREVIEW_CONTENT_SECURITY_POLICY`, `compileTemplate` (LRU). These are entangled with the full render pipeline (Handlebars, skills, sections). |
| `backend/src/services/resumeDocument.ts` (`buildPreviewResume`, `resumeForTemplate`), `services/templateChoice.ts`, `routes/templates.ts` (GET /, GET /:id/preview) | - | Needed by the thumbnail pipeline and the template names. |
| `backend/src/database/documentTable.ts`, `resumeRepository.ts` | - | Storage pattern (JSON doc plus indexed columns); reusable for a `cover_letters` table. |

### 11.3 Not part of these views (drop unless a decision keeps them)

- `ProfileDialogs.tsx` (ProfileNameDialog, DeleteProfileDialog, MoveResumesDialog, NewResumeDialog), `KeywordChips.tsx`, `KeywordsCard.tsx` and `components/subscription/LockedFeature.tsx` (+ `lib/subscriptions.ts`) for the profile limit.
- `TemplateCard.tsx`, which the task listed, is **not** a gallery card. It is the editor's Customize-tab "Template" picker (`<select id="resume-template">`) and "Layout" card (`TemplateCard.tsx:36-174`). The gallery card for templates is in `TemplateChooser.tsx:172-205` (`.templateGrid`, `.templateCard`, the hover pill "Preview", the uppercase `.templateName`), which uses `PageThumb` with `src`.
- `ResumePreview.tsx` is the **Build Resumes** preview modal, not the list. It frames `srcDoc` in `sandbox=""` at `w-full h-[1056px]` inside `max-w-[816px]`, which are US-Letter dimensions, unlike PageThumb's A4 (`ResumePreview.tsx:110-113`).

---

## 12. Generalizing the two views so Cover Letters reuse them (design proposal, INFERRED)

### 12.1 What free_tailor has for cover letters (VERIFIED code)

- There is **no cover-letter entity**: no table, repository, CRUD route, list, preview or editor (grep over `backend/src/database` and `routes`).
- A letter is the optional `coverLetter?: string` of `TailoredContent` ("Cover letter body content without the greeting or sign-off", `backend/src/types/template.ts:268-269`). It is written by the tailoring model and saved as files next to the tailored resume.
- `buildCoverLetterHTML(content, resumeName)` (`backend/src/generators/coverLetterGenerator.ts:55-66`) renders it as `<body style="font-family: Arial, sans-serif; font-size: 11pt; color: #1A1A1A; line-height: 1.5;">`. The body holds a random greeting (`Hello Hiring Team,` / `Hi Hiring Team,` / `Hello Team,` / `Hi Team,`), one `<p style="margin:0 0 12pt 0; line-height:1.5">` per paragraph, `Best regards,` and the name.
- The PDF is printed by Puppeteer as A4 with 0.75in margins (`:92-126`). A DOCX version goes through html-to-docx with Arial 11pt and 0.75in margins (`:132-154`).
- **Consequence:** the Cover Letters grid and list in TailorIT need a new data model, CRUD, a list summary and a page renderer. The free_tailor letter HTML is a usable starting point for the renderer.

Simplify side: the build manifest downloaded by the simplify-documents worker lists the routes `/documents`, `/cover-letter`, `/cover-letter/[id]`, `/cover-letter-template` and `/cover-letter-template/[id]` (VERIFIED asset: `C:/Users/Kelvin/AppData/Local/Temp/claude/f--Develop-TailorIT/3e5e2405-8333-495c-b973-a88d115cb0dc/scratchpad/simplify_raw/simplify-documents/buildManifest.js`, grep for `"/cover-letter`). Simplify's cover-letter fields, list columns and menu items are UNKNOWN here; see the simplify-documents report.

### 12.2 Proposed generic layer (frontend)

```ts
// lib/documentGallery.ts: no React; unit-testable like profileDashboard.ts
export type DocumentKind = 'resume' | 'cover-letter';
export type ViewMode = 'grid' | 'list';
export function readViewMode(storage: Pick<Storage,'getItem'> | null, key: string): ViewMode;   // 'list' only if exactly 'list'
export function writeViewMode(storage: Pick<Storage,'setItem'> | null, key: string, mode: ViewMode): void;
export function editedAgo(updatedAt: string | undefined, now: number): string | null;          // verbatim resumeGallery.ts:153-163
export function editedLine(updatedAt: string, now: number): string;                              // ?? `Edited ${toLocaleDateString}`
export function matchesQuery(query: string, fields: ReadonlyArray<string | undefined>): boolean;  // verbatim profileDashboard.ts:146-150
export function describeMatches(shown: number, total: number, noun: { one: string; many: string }): string;
export function newestFirst<T extends { id: string; updatedAt: string }>(items: readonly T[], pinnedId?: string | null): T[];

// components/documents/thumbCache.ts: ResumeCards.tsx:46-100, generalized
export const thumbKey = (kind: DocumentKind, id: string, updatedAt: string) => `${kind}:${id}:${updatedAt}`;
export function loadThumb(key: string, fetchHtml: () => Promise<string>): Promise<string>;  // LRU (24, or about 48 for two kinds) + in-flight de-duplication

// components/documents/DocumentThumb.tsx: ResumeThumb generalized
export function DocumentThumb(p: { cacheKey: string; fetchHtml: () => Promise<string>; title: string;
                                   page?: { widthPx: number; heightPx: number } }): JSX.Element;
// IntersectionObserver(rootMargin '300px') → loadThumb → <PageThumb srcDoc/>; shimmer; "No preview"

// components/documents/DocumentCard.tsx: ResumeCard's DOM, kind-agnostic
export function DocumentCard(p: {
  kind: DocumentKind; id: string; href: string; label: string;
  thumb: ReactNode;                 // <DocumentThumb …/>
  overlayBadges?: ReactNode;        // ★ Default, Disabled …
  dimmed?: boolean;                 // → data-disabled
  meta: ReactNode[];                // lines under the title (links allowed)
  warning?: string;
  items: readonly ActionMenuItem[];
}): JSX.Element;                    // renders article[data-${kind}-card]

// components/documents/DocumentList.tsx: ResumeRow + the header, kind-agnostic
export interface DocumentColumn<T> { key: string; header: string; track: string; cell: (item: T) => ReactNode; }
export function DocumentList<T>(p: {
  kind: DocumentKind; columns: DocumentColumn<T>[];   // first column = the main (link + inline badges)
  items: readonly T[]; getId(t: T): string; getHref(t: T): string; getLabel(t: T): string;
  inlineBadges?(t: T): ReactNode; dimmed?(t: T): boolean; itemsFor(t: T): ActionMenuItem[];
}): JSX.Element;
// <ul class=list style={{ '--row-cols': `${columns.map(c => c.track).join(' ')} 2.5rem` }}>
//   CSS: .listHead, .listRow { grid-template-columns: var(--row-cols) }  (and the existing ≤640px override)

// components/documents/NewTile.tsx: NewResumeTile/NewTile generalized
export function NewTile(p: { kind: DocumentKind; label: string; hint: string; onClick(): void;
                             blockedReason?: string; locked?: LockSpec | null }): JSX.Element;

// components/documents/DocumentCollection.tsx: one tab panel
//   controls (SearchBox + ViewToggle) → status line → grid (NewTile first) | list → empty state
export function DocumentCollection<T>(p: {
  kind: DocumentKind; noun: { one: string; many: string }; viewKey: string;
  items: readonly T[]; searchFields(t: T): Array<string | undefined>;
  newTile: { label: string; hint: string; onClick(): void };
  card(t: T, now: number): ReactNode; columns: DocumentColumn<T>[]; row adapters…;
  empty: { title: string; body: string; actionLabel: string };
}): JSX.Element;
```

Why this split works: everything visual about the two views is already in `PageThumb`, the `.card`/`.list` CSS, `ActionMenu`, `SearchBox` and `ViewToggle`. The only resume-specific parts are the label rules, the meta lines, the badges, the menu items, the thumbnail fetcher and the column definitions, and those become per-kind adapters.

### 12.3 The two adapters

**Resumes** (follows free_tailor; INFERRED mapping):

- Without profiles, use the profile-page variant.
- Card: `meta = [editedLine · templateName]`; overlay ★ Default and Disabled badges if those concepts stay.
- Columns: `Resume` (main, `minmax(0,2.2fr)`) | `Name on resume` (`minmax(0,1.4fr)`) | `Template` (`minmax(0,1.4fr)`) | `Edited` (`10rem`) | ⋮ (`2.5rem`).
- Sort: `newestFirst(resumes, defaultResumeId)`.
- Thumbnail: `fetchHtml = () => resumesApi.preview({ resume:{}, resumeId:id, sample:false }).then(a => a.html)` with `cacheKey = thumbKey('resume', id, updatedAt)`.
- Menu: the §5.6 list minus whatever is decided out.

**Cover letters** (Grid and List; Simplify fields to confirm):

```ts
interface CoverLetterSummary {   // proposed list shape (no body text needed for the views)
  id: string; title: string; company?: string; jobTitle?: string; jobId?: string;
  templateId?: string; createdAt: string; updatedAt: string;
}
```

- Card: label `title || 'Untitled cover letter'`; meta lines `[company · jobTitle]` and `[editedLine · templateName]`. There is no ★ unless Simplify has a default letter (UNKNOWN).
- Columns: `Cover letter` (`minmax(0,2.2fr)`) | `Job` (`minmax(0,1.4fr)`, company and role) | `Template` (`minmax(0,1.4fr)`) | `Edited` (`10rem`) | ⋮.
- Search fields: title, company, jobTitle.
- Menu (proposal): Edit, Duplicate, Download PDF, Download DOCX, Delete (danger, `ruleBefore`).
- Thumbnail: `cacheKey = thumbKey('cover-letter', id, updatedAt)`; `fetchHtml = () => coverLettersApi.preview(id).then(a => a.html)`.
- New tile: "New cover letter" with a hint such as "Start from a template" (copy UNKNOWN; align with Simplify).
- View key: separate per tab (`tailorit.documents.coverLetters.view`) or shared (free_tailor's "the view is the person's" rule). This is a product choice; see Open questions.

**Cover Letter Templates (list only):** reuse `DocumentList` with the same columns concept and no thumbnail fetches. It is out of scope here, but the generic list supports it unchanged.

### 12.4 Backend additions for cover-letter thumbnails (INFERRED)

- **Storage:** a `cover_letters` table on the free_tailor DocumentTable pattern: `id, owner_id, title, data JSON, created_at, updated_at` with an index on `(owner_id, updated_at)`. Owner-scoped SQL is a must; free_tailor's `listResumesFor` JS filter should not be copied.
- **List:** `GET /api/cover-letters` returns `CoverLetterSummary[]` (light; no body text).
- **Preview:** `GET` or `POST /api/cover-letters/:id/preview` returns `{ html, page:{widthPx,heightPx} }`. The pipeline would be the letter's render (start from `buildCoverLetterHTML`, or a Handlebars cover-letter template if Cover Letter Templates are styled documents), then `withPreviewContentSecurityPolicy`, then a page chrome equivalent to `previewPageChrome` with margins 0.75in (72px) on A4 794x1123, or Letter 816x1056. The client keeps `sandbox=""` and the CSP stays.
- **Alternative (cheaper client, heavier server):** rasterise first pages to PNG with Puppeteer. free_tailor already ships `config/browser.launchBrowser` for PDFs. Cache the PNGs keyed `kind:id:updatedAt:templateUpdatedAt` and serve them as `<img>`. This removes N iframes per screen, and both kinds benefit.
- **Server render cache (either way):** an in-memory LRU of rendered HTML keyed `kind:id:updatedAt:templateId:templateUpdatedAt` would make tab switches across reloads free. free_tailor has none.

---

## 13. Simplify alignment notes

- The free_tailor views follow **FlowCV**, not Simplify. Keep the structure and behaviour (§3-§8); take colour, type, radius, shadow and wording from the simplify-design and simplify-documents reports (VERIFIED code comments: `resumePages.module.css:1-12` "drawn after FlowCV's 'My Resumes'…", `ResumeCards.tsx:21-25, 198-204`).
- Brand assets to avoid: none of the free_tailor views uses Simplify assets. free_tailor's own look is a deliberate FlowCV look-alike (warm desk, plum, pink-coral gradient, DM Sans), and its wordmark "Tailor" is free_tailor's. If TailorIT is to look like Simplify, these FlowCV-derived values should not survive the re-skin. Simplify's logo, name, mascot and illustrations are listed by the simplify-design and simplify-documents keys (UNKNOWN here).

---

## 14. Risks and issues for the architecture

1. **No cover-letter backend exists in free_tailor** (§12.1). The whole Cover Letters tab (storage, CRUD, list, preview or thumbnail, editor, downloads) is new work; only the two views are reusable.
2. **Profiles coupling.**
   - The views, menus and the new-resume flow assume a person/profile layer: the profile column and link, ★ default, Move, the profile limit lock, and `?profile=` on New resume.
   - The server places a resume by **person name** when no `profileId` is given, and that can create a new profile and hit the 402 `profile-limit` on a Default tier (CLAUDE.md 2121-2135, 2195-2213).
   - If TailorIT hides profiles, it must either always pass the user's single profile id or remove name-based placement and the limit. If it does neither, a second resume with another person's name silently creates a profile or is refused.
3. **The look is FlowCV's**, not Simplify's. A re-skin is needed even though the user said the resumes views "follow current repo code". The two instructions may disagree on visuals (see Open questions).
4. **Performance does not scale.**
   - The list loads every resume as a full document, with keywords re-derived per read.
   - It also loads every template including its markup (about 300 KB for 27 built-ins), just to print names.
   - A profile page downloads all of the account's resumes and filters them client-side.
   - `listResumesFor` loads every account's resumes and filters in JavaScript.
   - Each grid card issues its own `POST /resumes/preview`, with no concurrency cap and no server cache. Each visible card mounts a full HTML document in an iframe, and there is no pagination or virtualization.
   - Recommendation: add light summary endpoints, a server render cache (or PNG thumbnails) and a concurrency limit on thumbnail fetches.
5. **Auth for thumbnails.** Resume thumbnails rely on POST plus `srcdoc` (bearer header via fetch). Template thumbnails rely on cookie-authenticated `src` on the API origin (`getApiOrigin`). TailorIT's auth (ft-auth key) must support both, or use only the srcdoc path.
6. **A4 hard-coded** in PageThumb (794x1123) and in the CSS `aspect-ratio`. The server's returned `page` size is ignored, and the builder's `ResumePreview.tsx` uses Letter (816x1056). If TailorIT targets US users, as Simplify does, choose a paper size and pass it through.
7. **A11y gaps to fix while porting.** The List view has no column semantics for screen readers (the header is aria-hidden; rows are `li`/`div`). Resume Delete uses the native `window.confirm`, which is unstyled and not Simplify-like.
8. **`:has()`** is used for the thumbnail focus ring (`.cardThumb:has(.cover:focus-visible)`). It is fine on current browsers, but it is a progressive-enhancement point.
9. **Behaviour is pinned by tests in free_tailor** (`backend/test/frontendProfiles.test.js`, `backend/test/e2e/profiles.js`), which TailorIT will not inherit. The e2e steps are a ready-made acceptance checklist (tabs, URL, persistence across reload, search counts, menu order, focus return, 390px, dark mode) worth re-implementing.
10. **Dark mode.** free_tailor supports `html.dark` throughout these views. Whether Simplify-styled TailorIT needs dark mode is UNKNOWN. The token layer supports either.

---

## 15. Open questions (need an owner decision)

1. Does TailorIT keep free_tailor's **profiles** (persons) at all?
   - If not, should Documents > Resumes use the profile-page variant (no profile column; "Name on resume" column)?
   - Which items leave the ⋮ menu (Move to another profile..., Set as default)?
   - Should name-based placement and `profileLimit` be removed server-side?
2. Keep the **★ Default resume** concept? It drives Fully Tailor in free_tailor. And keep **Disable/Enable** (excluded from Build Resumes), **Keywords** (matcher data) and **Download JSON / Import JSON / Import PDF**?
3. Visuals: should the free_tailor resume views be **re-skinned with Simplify tokens** (recommended) or keep free_tailor's FlowCV look inside a Simplify shell?
4. **Paper size** for resumes and cover letters: A4 (free_tailor) or US Letter (Simplify's market)?
5. **Cover letter data model**:
   - Which fields (title, linked job, company, role, template, body)?
   - Is a letter tied to a tracked application or job?
   - Are Cover Letter Templates styled, Handlebars-like documents or text snippets?
   - These answers determine the preview renderer.
6. **Thumbnail technique for TailorIT**: keep free_tailor's iframe-srcdoc approach for both kinds (parity with PDF, more DOM), or add server-side PNG rasterisation with caching?
7. **View persistence key**: one shared key for Resumes and Cover Letters, as free_tailor shares one key across its pages, or one per tab? Should search queries persist?
8. **Routing**: should Documents be one page with `?tab=resumes|cover-letters|templates` (the free_tailor tab pattern) or separate routes? Simplify's manifest shows `/documents`, `/cover-letter`, `/cover-letter/[id]`, `/cover-letter-template` and `/cover-letter-template/[id]`.
9. Expected **document counts per user**: is pagination or virtualization needed, which free_tailor has neither of?
10. The **⋮ menu set for cover letters** (Edit, Duplicate, Download PDF/DOCX, Rename?, Delete) and the New tile copy.
