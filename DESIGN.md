---
name: Codex Report workstation
description: A readable desktop workspace for recorded Codex activity.
colors:
  primary: '#345bdd'
  dark-canvas: '#101216'
  dark-surface: '#181c23'
  dark-ink: '#f2f5fb'
  dark-muted: '#b2bbca'
  dark-selection: '#233451'
  dark-accent: '#a6c0ff'
  light-canvas: '#f3f5f9'
  light-surface: '#ffffff'
  light-ink: '#192336'
  light-muted: '#526179'
  light-selection: '#e9efff'
  light-accent: '#284fb9'
typography:
  headline:
    fontSize: '2.1rem'
    fontWeight: 660
    lineHeight: 1.2
  title:
    fontSize: '1.35rem'
    fontWeight: 650
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1rem'
    lineHeight: 1.55
  label:
    fontSize: '0.94117647rem'
rounded:
  surface: '0.85rem'
  control: '0.55rem'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.light-surface}'
    rounded: '{rounded.control}'
---

# Design System: Codex Report

## Overview

**Creative North Star: "The Activity Workstation"**

A desktop tool for reading recorded work and inspecting conversations without
losing context. Horizontal navigation leaves a broad working canvas. The visual
system is restrained; its distinctiveness comes from a selected-day activity
readout, adjacent session inspector and keyboard command search, not decoration.

## Colors

Neutral ink and porcelain surfaces support blue interaction accents. Theme ramps
are composed separately in `public/style.css`; explicit Light and system-light
map to identical tokens. Blue/teal/violet distinguish chart categories. Emerald,
violet, amber and rose outcomes retain literal labels; color never stands alone.

**The Recorded Evidence Rule.** Unpriced work is not zero-dollar work. Qualify
partial estimates at the point of display; provider snapshots and local workload
remain separate sources of information.

## Typography

One native system sans family carries UI and data. Identifiers alone use a
monospace stack. Numerical values use tabular figures. No font files, uninstalled
font promises or remote font requests are introduced.

The optional saved `dashboard.fontSize` remains an integer 14..24, default 17.
Allowlisted root percentages preserve browser text defaults. Every descendant
text role uses rem or inheritance, including placeholders, controls, options,
charts, badges, disclosures and dialogs. Spacing and icons scale as well.

**The One Scale Rule.** Never compensate for insufficient space by shrinking a
component's typography at a breakpoint. Reflow the container instead. Browser
zoom remains available.

## Layout

The workspace header has a brand/status/search row and horizontal navigation.
Main content is bounded at 94rem. An unboxed summary ribbon precedes the activity
board and workflow rail. Session browsing uses a persistent list beside one
inspector rather than nesting every conversation's contents on the page.

Workspace container thresholds at 68rem, 57rem and 40rem reflow columns, lists
and forms as text grows. The inspector has its own 37rem threshold. Header media
rules handle narrower computer windows. This is not a phone-first design.

## Elevation & Depth

Panels use a single subtle border and tonal separation, not stacked shadows.
Dialogs alone use the semantic shadow and backdrop. Theme colors switch together
rather than through a low-contrast foreground/background crossfade.

## Shapes

Surface corners use the shared radius; controls have smaller rounding. Consistent
stroke SVG icons mark actual actions. Charts render real data rectangles; no
illustrative SVG scenes, remote images or decorative assets are present.

## Components

Navigation keeps the active page visibly underlined. Buttons have explicit names,
focus outlines, disabled state and 44px minimum height at the smallest text size.
Recorded-day columns are selectable buttons with exact-value text and an alternate
data table. Missing days are not silently inserted as zero.

The session list exposes selection with aria-pressed and an inspector target.
Search, outcome filters, sorting and pagination work over the selected report.
Expanded turns retain state across data refresh. Technical IDs are disclosed on
demand, and names are rendered as text, never markup.

Command search is a native dialog with combobox/listbox semantics and active
result identity. Ctrl/Cmd+K opens it; arrows select, Enter navigates, Escape closes
and focus returns. It searches pages and recorded sessions in the current report.

Settings retains Appearance, Reporting and Billing in one mounted form. Theme and
font size preview globally; save persists through the revision-checked endpoint;
discard restores saved appearance. Hidden invalid fields are revealed before
focus. The save actions remain in normal flow and cannot cover enlarged content.

## Do's and Don'ts

- Do preserve accounting, settings revision, authentication and privacy contracts.
- Do retain last loaded data during transient errors and reject stale filter results.
- Do use semantic tokens and the shared root scale for new components.
- Don't add fake activity, savings claims, quota inferences or artificial zeroes.
- Don't add external assets, fonts, telemetry or runtime frameworks for decoration.
- Don't shrink fonts or hide page overflow to conceal a broken layout.
