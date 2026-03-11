# App Refactor Structure

This document describes the structural refactor applied to `src/App.tsx` to reduce coupling and isolate reusable logic.

## Goals

- Move reusable logic (types, constants, helper functions) out of `App.tsx`.
- Split major UI sections into focused panel components.
- Add unit tests for extracted utility behavior.

## High-Level Changes

## 1) Shared app modules

- `src/app/types.ts`
  - App-local UI/domain types previously declared in `App.tsx`.

- `src/app/constants.ts`
  - Storage keys, default settings, RPC defaults, sync thresholds, ANSI palettes.

- `src/app/utils.tsx`
  - Extracted helpers for:
  - formatting and parsing,
  - RPC URL normalization,
  - persisted settings bootstrap,
  - node/wallet bridge helpers,
  - ANSI log parsing,
  - RPC block/head fetching.

## 2) Panel/component extraction

- `src/components/panels/SettingsPanel.tsx`
  - Settings tab UI and form rendering.

- `src/components/panels/ProducerPanel.tsx`
  - Producer tab UI and wallet/producer actions rendering.

- `src/components/panels/ExplorerPanel.tsx`
  - Explorer tab stats + blocks table rendering.

- `src/components/panels/NodeFileEditorModal.tsx`
  - Managed file editor modal extracted from `App.tsx`.

- `src/components/panels/AppFooter.tsx`
  - Footer status UI extracted from `App.tsx`.

## 3) App orchestration

`src/App.tsx` now focuses on:

- state orchestration,
- effects and polling,
- node/wallet action handlers,
- composing extracted panels and modal components.

## Current file ownership

- `src/App.tsx`
  - App-level orchestration + Node tab rendering (still the largest remaining section).

- `src/app/*`
  - Reusable app logic and primitives.

- `src/components/panels/*`
  - Presentation/layout for non-node panels and shared app chrome pieces.

## Testing

### Test setup

- Added `vitest`.
- Added `vitest.config.ts` to scope tests to `src/**/*.test.ts(x)`.
- Added npm scripts:
  - `npm test`
  - `npm run test:watch`

### Unit tests added

- `src/app/utils.test.ts`
  - URL normalization/sanitization.
  - RPC source selection fallback behavior.
  - Backup URL validation.
  - Base-dir/path normalization.
  - Block row mapping.
  - ANSI parsing.
  - Node RPC URL resolution.

## Verification commands

- `npx tsc -p tsconfig.json --noEmit`
- `npm test`
- `npm run build:renderer`
- `npm run build:electron`
