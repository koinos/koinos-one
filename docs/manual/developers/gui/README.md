# GUI Development

The GUI is a React + TypeScript renderer running under Electron. It talks to
the Electron main process through a preload bridge and IPC. The main process
owns native runtime operations, local storage, wallet actions, backup commands,
and process supervision.

## Pages

- [Electron, Vite, React, And TypeScript Structure](electron-vite-react-structure.md)
- [App State And Native Bridge](app-state-and-native-bridge.md)
- [i18n And GUI Copy](i18n-and-gui-copy.md)
- [Settings And Operational Screens](settings-screens.md)
- [GUI Packaging](packaging.md)

## Main Files

- `src/main.tsx` - React mount point.
- `src/App.tsx` - app state orchestration, tab routing, polling, and bridge use.
- `src/components/panels/` - major UI panels.
- `src/app/` - renderer helpers, types, network data, producer helpers, chain
  sync helpers, and normalization logic.
- `src/i18n.ts` - English and Spanish GUI strings.
- `src/styles.css` - global visual system and panel styling.
- `electron/preload.ts` - secure bridge exposed to the renderer.
- `electron/main.ts` - Electron main process composition.
- `electron/lib/ipc-handlers.ts` - IPC channel registration.

## Development Rule Of Thumb

Renderer code should ask bridge helpers for native behavior. Electron main
services should own filesystem, subprocess, wallet, native node, and IPC
side-effects. Do not put privileged operations directly in the renderer.

## GUI Change Checklist

- Keep visible text in `src/i18n.ts` for English and Spanish.
- Keep settings and operational screens visually consistent with surrounding
  panels.
- Keep first-run setup packaged-runtime-only and observer-first.
- Inspect the affected screen after layout or copy changes.
- Run focused Vitest or Playwright coverage for changed behavior.
