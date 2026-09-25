# Desktop workspace design

Surface mode: Operate. Prioritize comfortable reading on computers, predictable
controls, and progressive detail. Phone layouts are not a product target; smaller
computer windows and browser zoom must still work.

## Color system

Use a cool near-black / crisp-white pair, with electric indigo for primary
controls and selection, violet for secondary emphasis, and cyan as a third data
category. Do not reuse action colors as implied usage outcomes. Successful work
is emerald, interruptions violet, exceeded usage amber, and other failures rose.
Each outcome also has a text label.

All values are CSS semantic tokens: canvas, sidebar, surface, raised, field, ink,
muted, subtle, line, line-strong, primary/fill/hover/ink/wash, secondary/wash,
status pairs, and chart categories. Dark and light ramps are composed separately.
System-light maps to exactly the explicit light tokens. Primary filled buttons
retain white labels on hover; ordinary secondary actions remain neutral. Theme
foreground and background switch together, not through an unreadable crossfade.

## Typography and global sizing

Use the native modern system sans stack, consistent weights, comfortable leading,
and tabular measurement figures. Do not promise an uninstalled face, bundle font
files, or load remote fonts. Code identifiers retain an appropriate monospace role.

The stored `dashboard.fontSize` is an optional whole number from 14 through 24,
with a nominal 17 default. Old configurations without it keep working and are not
rewritten merely by reading them. A browser's ordinary 16px initial size maps to
17px body text at the default; percentages preserve browser text preferences.

A validated `data-font-size` attribute selects the root percentage. Every text
role uses `rem` or inherits it: body, headings, metadata, navigation, buttons,
inputs, options, table cells, HTML chart labels, badges, notices, code/pre,
placeholders, footers, and dialogs. Numeric headings remain larger than labels;
scaling never makes every role the same size. No fixed-pixel descendant fonts,
CSS zoom, page transforms, or disabled browser zoom. Browser-owned menus/chrome
and terminal text are outside document styling.

Core spacing, icons and controls grow with the root, with a 44px minimum control
height at the smallest user setting. Container queries reflow crowded data and
forms instead of shrinking type. Tables may scroll inside their own labelled
region. Save controls remain in normal flow so enlarged forms are not obscured.

## Settings behavior

Appearance has a numeric size input, keyboard-operable slider, and Reset to 17.
Both theme and size preview across the document immediately. Save uses the existing
revision-checked settings endpoint. A rejected save retains the draft and preview;
discard/reload restores saved appearance. Switching settings tabs never loses
edits. Reset and all inputs are disabled during an in-flight save. Newly opened
pages and dialogs inherit the saved size without individual component overrides.

Appearance, Reporting, and Billing remain one mounted form. Native constraints
reveal and focus the first invalid field even when its panel is hidden.

## Preserved product contracts

Usage data, pricing, account attribution, quotas, hooks and ledger schemas remain
unchanged. Authentication, same-origin write requirements, backups and audit entries
stay in force. No external resources, analytics, provider requests or dependencies
are introduced. Empty and unpriced usage remain distinct from zero-dollar usage.
