# @neuraipse/annotate

A feedback loop between you and your AI coding agent. Point at what is wrong in the running UI, adjust it with your design tokens, copy a precise from → to instruction block.

## The concept

Telling an agent what is wrong with a UI is slow and vague. "Make the card padding bigger" leaves the agent guessing which element, which property and which value.

Annotate lets you select the real element on the page, see its real measurements and tokens, and say what should change. You copy structured output. The agent applies it in code. Nothing is ever written to source.

Tokens matter because the agent edits `var(--spacing-3)` or a Tailwind utility, not `24px`. A raw pixel value gets hard-coded. A token keeps the fix on your design system.

## How it works

```
 Select ──> Inspect / adjust ──> Preview live ──> Copy
    ^                                               │
    │                                               v
 Re-inspect <──── Reload <──── Agent edits code <───┘
```

The only change to the page is one preview `<style>` element. It is reverted on Esc, Clear and exit.

## Features

Single keys work while the toolbar is open and focus is not in a text field. Toggle the toolbar with Cmd/Ctrl+Shift+F.

| Feature | Key | What it does |
|---|---|---|
| Annotate | none | Default mode. Click an element, select text, Cmd/Ctrl-click for multi-select, or drag an area. |
| Freeze | `P` | Pauses CSS animations, Web Animations and media. Resume restores the previous state. |
| Spacing inspector | `M` | Shows border box, padding, margin and flex/grid gap bands with token labels. Click to edit in the side panel. |
| Box and Lines | `V` | Sub-modes of Spacing. Box selects whole padding, margin or gap rings. Lines pins edges and draws measure lines. |
| Drag handles, token guides | none | In Box, drag handles snap to tokens and faint guides mark token steps. |
| Type inspector | `T` | Groups elements by computed type signature. Edits size, line-height, weight and tracking with token pickers and a guide ladder. |
| Colour inspector | `K` | Edits `color`, `background-color`, border, `fill` and `stroke` with colour tokens. Shows the live WCAG contrast ratio. `C` is Copy, so colour uses `K`. |
| Layout mode | `L` | Drop wireframe components on the page. Saved as placements. |
| Rearrange mode | `R` | Move, resize, nudge or hide existing elements with snap guides. Saved per route. |
| Hide | `H` | Hides or shows markers. Needs at least one annotation. |
| Copy | `C` | Copies the output in the chosen detail level. |
| Clear | `X` | Removes annotations, placements, rearrangements and pending style changes for the route. |
| Send | `S` | Sends output through `onSubmit`, a webhook or an endpoint session. Needs one of them set. |
| Settings | none | Output detail (compact, standard, detailed, forensic), marker colour, light/dark theme, clear on copy, block page interactions, React component info, MCP and webhook URLs. |

## What you copy

Standard detail, a feedback item followed by a style change:

```md
## Page Feedback: /settings
**App:** Demo
**Viewport:** 1440×900

### 1. button "Save"
**Location:** main > form > button[data-testid="save"]
**Source:** src/app/settings/form.tsx:42:9
**React:** SettingsForm > SaveButton
**Selected text:** "Save changes"
**Feedback:** Make this primary and disable while saving.

### Style changes
**1. Padding · .card-body** (3 elements)
- Selector: `main > section.card > div.card-body`
- Source: apps/host/src/app/components/card/page.tsx:42
- padding-top: `var(--spacing-2)` 8px → `var(--spacing-3)` 24px
- Elements: `.card-body` ×3
```

Compact prints one line per change. Forensic adds computed before/after values and the winning rule. A checklist form (`- [ ] Change …`) is available through `styleChangeStyle: "todo"`. Layout and Rearrange output appear under `### Layout placements` and `### Rearrangements`.

The output format and `Annotation` fields are interoperable with Agentation consumers.

## Quick start

Install in development:

```bash
npm install --save-dev github:mossyblog/NeurAIpse.Dart
```

Mount `Annotate` in your React app during development. Shadow DOM styles are bundled automatically (no global CSS import required); `@neuraipse/annotate/styles.css` is also exported if you need the standalone compiled stylesheet:

```tsx
import { lazy, Suspense } from "react";

const Annotate =
  process.env.NODE_ENV === "development"
    ? lazy(() => import("@neuraipse/annotate").then((m) => ({ default: m.Annotate })))
    : null;

export function DevAnnotate() {
  if (!Annotate) return null;
  return (
    <Suspense fallback={null}>
      <Annotate appName="MyApp" />
    </Suspense>
  );
}
```

Open the page, press Cmd/Ctrl+Shift+F.

| Prop | Purpose |
|---|---|
| `appName` | Shown as `**App:**` in the output. |
| `copyFormat` | `"markdown"` (default), `"source"`, `"classes"` or `{ attribute }`. |
| `onCopy`, `onSubmit` | Receive the output. `onSubmit` is awaited and a rejection keeps your feedback. |
| `onAnnotationAdd/Update/Delete`, `onAnnotationsClear` | Lifecycle callbacks. |
| `endpoint`, `sessionId`, `onSessionCreated` | Sync to a server session. |
| `webhookUrl` | http(s) URL that receives annotation events. |
| `useHashLocation` | Scope feedback per pathname and hash. |
| `enableKeyboardShortcuts` | Default `true`. `false` disables all keys, including the toggle. |
| `onOpenSource`, `identifyingAttributes`, `portalContainer`, `className` | Editor link, stable selector attributes, mount target, root class. |

## Status

| Item | State |
|---|---|
| Version | 0.6.0 |
| Scope | Development builds only. Not for production. |
| Browser | Chromium desktop. Token resolution needs CSS Typed OM. |
| React | 19.2+ |
| Sync and webhooks | Verified against a mock server only (`tests/mock-server.mjs`). |
| RTL | Keeps physical sides (left, right, top, bottom). |
| Newest | Rearrange and Layout modes. |

History: [CHANGELOG.md](CHANGELOG.md).
