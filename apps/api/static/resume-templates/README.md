# Resume templates (data)

These 26 template files are copied verbatim, as data only, from free_tailor v4.2
(`backend/static/templates/*.json`, commit 4112e8e) with the owner's approval. The
code that renders them (`packages/render`) is TailorIT's own, written to honour the
template contract described in `docs/ARCHITECTURE.md` (Appendix B).

Shape: `{ id, name, description, category?, source?, htmlContent, cssContent, sections, createdAt, updatedAt }`.
- 19 built-ins carry a `category` (simple | modern | creative), `section-<kind>` marker classes
  and the `{{> extra-sections ...}}` macro.
- 7 files with `source: "uploaded"` (the `ats-*` set, `sidebar-executive`, `9145ec7c-…`) have no
  markers and no macro; TailorIT lists them under the "ATS" category.

All templates use system fonts only and reference no external URLs.
