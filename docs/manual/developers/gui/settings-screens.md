# Settings And Operational Screens

Koinos One is an operational tool. Settings, Node, Backup, Wallet, Producer, and
Dashboard screens should be calm, compact, and easy to scan.

## Visual Consistency

New GUI surfaces must match surrounding panel hierarchy, spacing, typography,
border radius, contrast, color palette, and control style.

Do not introduce isolated dark cards, marketing panels, oversized headings, or
heavy visual blocks inside operational settings unless the surrounding screen
already uses that treatment.

## Box Model And Spacing

When a child sits inside a bordered parent, do not use `width: 100%` together
with horizontal margins unless the rendered width is constrained. Prefer:

- parent padding for inset spacing;
- `width: auto` for children with horizontal margins;
- `gap` on flex/grid containers for sibling spacing;
- `min-width: 0` on grid/flex children that contain long text.

Before finishing a layout change, verify that `scrollWidth` does not exceed
`clientWidth` unless horizontal scrolling is intentional, and inspect controls
near the left and right borders.

## Screen-Specific Notes

- Settings should keep configuration controls grouped and avoid surprise runtime
  side effects.
- Node > Backups owns backup and restore operations. Settings > Backup is
  configuration-oriented.
- Wallet and Producer screens must keep signing, burn, transfer, and producer
  registration states explicit.
- First-run setup is packaged-runtime-only and observer-first.
- Documentation tab should remain an index and orientation surface, not a heavy
  renderer for private implementation history.

## Control Patterns

Use controls that match the task:

- toggles or checkboxes for binary settings;
- selects or segmented controls for option sets;
- inputs, sliders, or steppers for numeric values;
- icon buttons for common actions when an icon is clear;
- text buttons for explicit commands such as restore, verify, save, or cancel.

Avoid nested cards and visually heavy blocks inside existing operational
settings screens. Most settings work best as compact groups with clear labels,
status text, and predictable spacing.

## Verification

For any GUI change, inspect the affected screen in the running app or with a
screenshot. Check text readability, edge spacing, button fit, disabled states,
and whether the screen still matches the visual language of its section.

For layout-sensitive changes, check that long English and Spanish labels do not
overflow their containers and that `scrollWidth` only exceeds `clientWidth` when
horizontal scrolling is intentional.
