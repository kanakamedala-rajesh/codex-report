# Desktop readability rework

Base: remote PR #1 at `8ba9f0fec3d95bec042a2762eaf0e46fea12e572`.

## Scope

Replace the small, crowded visual presentation across all five pages. Desktop and
laptop use is primary. Do not design phone navigation or spend acceptance testing
on phone viewports. Preserve browser zoom and split-window reflow. No backend,
accounting, schema, pricing, hook, dependency or saved-configuration changes.

## Initial Impeccable review

- P1 usability: 14px root, 13px labels, 12px metadata/code, 17px section headings
  create a nearly flat small-text hierarchy (public/style.css, reviewed remotely).
- P1 usability: the 1.65/1.0 chart/table split crams meaningful model data into a
  narrow panel at ordinary laptop widths. Both panels compete with four metrics.
- P2 usability: full billing, display, and reporting forms share one long page.
- P2 clarity: multiple outcome pills and redundant timestamps compete with session
  names; raw IDs and warnings dominate expanded turns.
- Preserve: safe text nodes, request revision checks, explicit unpriced states,
  provenance labels, native controls, unsaved changes and retained disclosure.

## Design preflight

<design_plan>
seed=128; architecture=Cinematic Center; type=Geist
components=Infinite Marquee, Inline Typography Images, Horizontal Accordions
motion=Scroll Pinning, Card Stacking

The requested working dashboard is Operate mode, not a marketing surface. The
seeded composition is translated to a broad title/action split, balanced data
regions and click-operated disclosures. Marquees, testimonials, stock imagery,
scroll pinning and GSAP landing-page choreography would conflict with uninterrupted
reading and the existing offline/no-dependency contract; do not add them.
Attention: clear page title. Interest: readable summaries. Detail: click-to-inspect
usage and sessions. Action: explicit navigation and saving, not a marketing CTA.

Use a single sans family with a fixed rem scale, 17px body, 16px labels/metadata,
36px page titles and 24px section titles. One wide main column (max 1580px);
four 1fr measurement cells become two columns for zoom, never tiny text.
Analytics switch between By day / By model, rather than compete side by side.
All rows have sufficient vertical space. No eyebrow labels. Tokenized AA contrast
and actual computed type size are audit assertions, not assumed from CSS.
</design_plan>

## Work packages

1. Rebuild desktop shell, type/spacing/theme tokens, Overview and session rows.
2. Simplify comparisons and health; add Appearance/Reporting/Billing settings tabs
   preserving all fields, save/conflict behavior, and pending edits across tabs.
3. Preserve request coalescing and stale-response rejection; make loading/error
   states explicit and avoid re-rendering while a user selects text or edits a name.
4. Run tests, type-check, formatting and desktop browser audit at 1280/1440/1920px
   plus zoom-equivalent layouts. Fix audited defects in one batch and confirm.
5. Commit against the remote branch without merging; document true verification
   scope and remaining CI limitations.

The Impeccable skill and audit playbook are loaded. Its engine context launcher
was attempted and could not download its binary because DNS is unavailable.
The direct skill-guided browser/code audit must not be labelled a binary-detector
run or an independent accessibility certification.
