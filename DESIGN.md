# Desktop workspace design

Surface mode: Operate. The user explicitly prioritizes readable computer layouts
and rejects small type, crowded panels, and phone-specific navigation.

## Typography and layout

Use one locally available sans family. Geist is the first preference, followed by
Segoe UI and platform sans; there is no font download or bundled font file.
The root is 16px, body and control text 17px, labels/notes/data metadata 16px,
section headings 24px, and page headings 36px. Do not scale graph text with SVG:
its labels and values are normal HTML text. Token values use tabular numerals.

Controls are at least 48px high, fields 50px, navigation 54px. A 260px desktop
sidebar and a bounded content column provide stable alignment. Laptop widths use
238px navigation without shrinking typography. Narrow computer windows reflow to
an ordinary wrapping navigation strip, not a phone drawer. Browser zoom must not
be disabled. No hard minimum page width or hidden horizontal overflow fix.

Overview presents summaries, then one wide day/model breakdown, then recent
sessions. Sessions progressively expose turns and technical identifiers. Settings
has Appearance, Reporting, and Billing tabs with one persistent form and save bar;
changing a tab must not rebuild fields or discard edits. Native field constraints
must reveal and focus the first invalid field even when its panel is hidden.

## Color and interaction

Slate and white theme surfaces with restrained teal emphasis; semantic status
colors remain distinct from chart categories. Dark, light, and system settings
retain their existing meaning. All colors belong to the CSS token system.

Use standard controls, visible keyboard focus, click-operated disclosures, and
short state transitions. No marketing hero, scroll hijacking, decorative imagery,
external resources, phone navigation, or animation framework. Reduced motion
removes transitions while retaining state changes and visible information.

## Truth and stability

No usage is not a zero-dollar claim. Unpriced work remains identified. Account,
model, and period filters keep the same API semantics. Expanded sessions, turns,
and meaningful focus survive refresh. Background updates pause while text is
being selected or a session name is being edited. Settings conflicts and failed
requests must retain input and show an actionable message, not silently reset it.
