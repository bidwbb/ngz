# CLAUDE.md

Project context and development notes for AI-assisted coding sessions.

## Project Overview

NGZ is an Electron desktop app that reads SPORTident (SI) cards for orienteering events. It validates punches against course definitions and shows results with sound feedback.

## Architecture

```
src/                          # Core library (Node.js, CommonJS)
  si-protocol/                # SPORTident protocol implementation
    types.ts                  # Shared pure types (SiPunch, SiCardData, NO_TIME)
    SiDriver.ts               # State machine for SI communication
    SiMessageQueue.ts         # Promise-based message queue + error types
    SiDataFrame.ts            # Card data parsing (Si5, Si6, Si8+)
    SiMessage.ts              # Protocol frame construction/validation
    SiSerial.ts               # Serial port adapter/discovery
    crc.ts                    # CRC-16 calculator
  course-validator/           # Course validation algorithms
    validator.ts              # Levenshtein inline + score-O matching

electron/                     # Electron app
  ipc-channels.ts             # IPC channel name constants (shared by main + preload)
  main.ts                     # Main process, IPC handlers
  preload.ts                  # contextBridge API
  renderer/                   # React frontend (Vite, ESM)
    vite.config.ts            # Vite config with @ngz alias
    src/
      App.tsx                 # Orchestrator: state, IPC listeners, header, routing
      App.css                 # All styles
      types.ts                # Local types + re-exports from @ngz
      utils.ts                # API facade, formatters, XML parser, sounds, event data
      components/
        StatusIndicator.tsx   # Connection status dot + label
        SetupScreen.tsx       # Port selection + event management (includes NewEventForm)
        WaitingScreen.tsx     # "Insert card" waiting screen
        ResultScreen.tsx      # Card read result with validation details
        LogScreen.tsx         # Read history + protocol log tabs
```

### Import Boundaries

The renderer (browser) cannot import modules that use Node.js APIs (`Buffer`, `serialport`). To share code between Node and browser:

- **`src/si-protocol/types.ts`** contains pure types (`SiPunch`, `SiCardData`, `NO_TIME`) with zero Node.js dependencies.
- **`src/course-validator/validator.ts`** imports only from `types.ts`, keeping it browser-safe.
- The Vite alias `@ngz` maps to `../../src`, allowing the renderer to import from these modules.
- **Do not** add Node.js imports (Buffer, fs, serialport, etc.) to `types.ts` or `validator.ts`.

## Build & Test

```bash
npm install                    # Root dependencies
npm run renderer:install       # Renderer dependencies (separate package.json)
npm test                       # Jest tests (src/)
npm run build                  # Build renderer (Vite) + compile electron (tsc)
npx electron-builder --win     # Build installer (win/mac/linux)
```

## Conventions

- TypeScript strict mode everywhere
- Core library in `src/` compiled as CommonJS (for Electron main process)
- Renderer uses Vite + React with ESM
- Tests use Jest with ts-jest preset, located in `__tests__/` directories
- SI protocol code ported from GecoSI (Java, MIT license) by Simon Denier
- Validation code ported from EasyGecNG (MIT license) by Thierry

## Completed Cleanup (v0.1.1+)

### Eliminated type duplication
Previously, `SiPunch`, `SiCardData`, `Course`, `ControlResult`, `ValidationResult`, and `NO_TIME` were all redefined inline in `App.tsx`. Now they are imported from the shared modules via `@ngz/si-protocol/types` and `@ngz/course-validator/validator`.

### Eliminated validation logic duplication
Previously, `validateInline()`, `validateScoreO()`, and `autoDetectAndValidate()` were reimplemented in `App.tsx` (~40 lines) duplicating the canonical versions in `validator.ts` (~210 lines). The App now imports `autoDetectCourse()` from the validator module.

### Split App.tsx into components
Monolithic 373-line `App.tsx` split into focused modules:
- `types.ts` — local types + re-exports from `@ngz/` (single import source for components)
- `utils.ts` — API facade, formatters, XML parser, sounds, built-in event data
- `components/` — `StatusIndicator`, `SetupScreen`, `WaitingScreen`, `ResultScreen`, `LogScreen`
- `App.tsx` — slimmed to ~95 lines: state management, IPC listeners, header, screen routing

### IPC channel constants
IPC channel names (`driver:status`, `serial:listPorts`, etc.) extracted from hardcoded strings into `electron/ipc-channels.ts`, imported by both `main.ts` and `preload.ts`.

### Extracted SiMessageQueue
`SiMessageQueue`, `TimeoutError`, and `InvalidMessageError` moved from inline in `SiDriver.ts` to their own module `src/si-protocol/SiMessageQueue.ts`.

### Named protocol constants
Hardcoded magic numbers in `SiDriver.ts` replaced with named constants: `BAUD_HIGH`/`BAUD_LOW`, `SERIAL_BUFFER_SIZE`, `SERIAL_TIMEOUT_MS`, `RESPONSE_TIMEOUT_MS`, `CARD_REMOVAL_TIMEOUT_MS`, `PUNCHES_PER_BLOCK`.

## Remaining Cleanup Opportunities

### Lower Priority

**Silent error swallowing** - `App.tsx` XML parser catches errors and returns null silently. Consider logging the error.

**Missing tests** - No tests for SiDriver state machine, Si6/Si8 parsing, React components, or IPC round-trips. Coverage reporting not configured.

**No linting** - No ESLint or Prettier configuration.

**Monolithic CSS** - `App.css` is 1000+ lines in a single file. Could use CSS modules or be split by component.
