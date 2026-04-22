# EDDM Planner — Runtime Config

This directory holds runtime configuration for the EDDM v2 redesign. Files
here are plain ES modules, imported by components at build time but written
to be easy to flip without needing to redeploy the whole app.

## Files

### `flags.js`

Two feature flags driving the Phase 1 → Phase N rollout of the redesign:

#### `MPA_PRICING_VISIBLE` (default: `false`)

Controls whether pricing is shown anywhere in the EDDM flow.

- **`false` (current default, shipping state):** All pricing UI is hidden —
  per-piece cost, postage estimates, line-item totals, the "Your price"
  sidebar, the checkout step. Every job is routed through
  **"Request my quote"** at Step 4 and handed off to the quote team.
- **`true`:** Pricing UI is shown throughout. Step 4 offers an instant
  checkout path in addition to the quote request.

Every pricing-dependent block in the UI must be guarded by this flag. Do
not hardcode pricing components outside the guard — if the flag is flipped
off in prod while pricing blocks leak through, we will leak pre-launch
rates to customers.

**How to flip it when the rate card lands:**

1. Edit `src/config/flags.js`, change `MPA_PRICING_VISIBLE = false` to
   `MPA_PRICING_VISIBLE = true`.
2. Open a PR. Vercel will auto-build a preview with pricing on.
3. QA against the preview URL. Confirm all price breakdowns render,
   postage calculations are correct, and the checkout path works.
4. Merge to `main`. Production deploy is automatic.

To flip it OFF again in an emergency (e.g. wrong price ships), flip the
flag back to `false`, merge, redeploy — or, if this gets converted to an
env var later, toggle it in the Vercel dashboard for zero-rebuild rollback.

#### `MPA_CANVA_TEMPLATES`

Map of postcard size key (e.g. `'6.25x9'`) to the corresponding MPA Canva
template (name + URL). Step 2 of the new flow reads this to render a
contextual "Start from our template" CTA once the user picks a size.

**Adding a new size:**

1. Add an entry to `MPA_CANVA_TEMPLATES` keyed by the new size (use the
   same stringified `WxH` format as existing keys).
2. The `url` must be the Canva `/view?...&mode=preview` link, not the
   edit link.
3. Confirm the size appears in the Step 1 size picker. Sizes that are
   NOT in this map will not render a template CTA — this is intentional
   for custom sizes that have no Canva equivalent.

**Current coverage:**

| Size     | Has template? |
|----------|---------------|
| 6.25×9   | yes           |
| 6.25×11  | yes           |
| 8.5×11   | yes           |
| 6.5×9    | no (intentionally — no matching template; size was removed from the picker) |
| Custom   | no (by design — routes to quote) |

## Not for production use yet

Phase 1 of the EDDM v2 redesign is **scaffolding only** — these flags and
the sibling `styles/tokens-v2.css` file are not yet imported by any
component. They land in Phase 2+ when the new UI starts replacing the
existing `EDDMMapper` surface.
