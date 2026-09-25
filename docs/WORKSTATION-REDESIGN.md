# Workstation frontend rebuild

Base: `cd8f7d2be29ce54e880e0b56af668f917136b692`, PR #1.
The user delegates the entire frontend direction, retaining desktop use,
legible global text sizing, and the existing product functionality.

## Direction contract

THESIS: A focused activity workstation, not another sidebar and stack of cards.
A horizontal workspace header opens onto a readable canvas. Sessions are a
master-detail explorer rather than a wall of nested accordions.

OWN-WORLD: Neutral ink and porcelain, blue interaction color, teal/violet data
categories, precise tabular measurements, inset toolbar and consistent rounded
controls. One native sans family; no uninstalled-font promise or remote assets.

STORY: Understand the selected workload, inspect one recorded day, move into a
conversation, then read its turns without losing the session list. Unknown prices
and provider snapshots stay explicitly separate from local usage.

FIRST VIEWPORT: Horizontal navigation, title/actions, a single filter band,
unboxed totals, then an activity plot beside a workflow summary. The chart uses
only recorded-day aggregates. A selectable day reveals exact values below it.

FORM: Code-led desktop application. The user explicitly delegates the visual
choice. Impeccable's launcher is not mounted; context/concept/detector execution
cannot be represented as completed. Its Operate and audit guidance govern the
direct review. gpt-taste's hierarchy/composition guidance is adapted to this tool,
not a marketing hero or scroll-pinned landing page.

SIGNATURE: Session selection opens a persistent adjacent inspector; command
search navigates pages or recorded sessions without leaving the keyboard.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
No raster assets or fonts ship in this implementation.

## Scope and gates

1. Replace all three public frontend assets. Preserve server/settings contracts.
2. Retain font scale 14..24, saved defaults, billing, revision conflicts, safe
   naming, filters, exports, exact values and interruption/quota classification.
3. Add session outcome/sort controls, recorded-day inspection and command search.
4. Test the real report/settings schemas and desktop behavior in both themes and
   at minimum/maximum font scales. Fixture and HTTP evidence are separate.
5. Record unavailable checks honestly; never weaken security or accounting tests.
