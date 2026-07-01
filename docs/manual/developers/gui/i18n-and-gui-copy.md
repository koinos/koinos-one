# i18n And GUI Copy

All visible GUI text must live in `src/i18n.ts` for both English and Spanish.

## When To Add Strings

Add or update i18n strings when changing:

- tab labels;
- button labels;
- form labels;
- help text;
- empty states;
- status messages;
- error messages;
- modal copy;
- tooltips;
- documentation text shown inside the app shell.

## Copy Consistency

When behavior changes, update visible copy in the same change. This is important
when a feature gains a new source of truth, fallback path, safety behavior, or
operational mode.

Keep each locale internally consistent. Product and protocol names such as
Koinos One, Teleno Node, KOIN, VHP, JSON-RPC, gRPC, and `teleno_node` can remain
as product terms. Avoid accidental mixed-language phrases when a clear
translation exists.

## Safety Copy

Mainnet producer registration, VHP burns, producer setup changes, config writes
targeting a producer, and transaction signing/submission are high-risk. GUI copy
must make these actions explicit and must not imply they happen automatically or
without user confirmation.

## Documentation Tab Copy

The Documentation tab loads the built MkDocs site from
`manual-site/index.html`. Text inside manual pages is authored as Markdown under
`docs/manual/`; visible app shell text around the iframe still belongs in
`src/i18n.ts`.

When documentation changes describe a GUI feature, verify that the visible GUI
labels and manual wording match the implemented behavior.

## Translation Quality

Spanish strings should be natural Spanish, not literal English word order with
Spanish nouns inserted. It is acceptable to keep product, protocol, and command
names as-is when they are established technical terms.

If a phrase names a safety-critical action, translate the warning with the same
level of specificity in both locales.

## Development Checklist

- Add English and Spanish strings in `src/i18n.ts`.
- Use `t('key')` from panel props or the app translator.
- Do not hardcode visible user-facing sentences in components.
- Check that button text fits at normal desktop window sizes.
- Inspect the screen after copy changes.
