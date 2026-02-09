# Baaton Desktop App — Tauri 2.x Plan

## Rationale
- Wrap the existing React frontend in Tauri 2.x for native desktop experience
- Same codebase, zero code duplication
- Native features: system tray, global shortcuts, native notifications, menubar

## Stack
- **Tauri 2.9+** (latest)
- **Webview**: System webview (no Chromium bundled → tiny binary ~3MB)
- **Frontend**: Point Tauri at the existing Vite dev server or dist/
- **Backend**: Remote API (`api.baaton.dev`) — no embedded backend needed

## Architecture
```
baaton/
├── frontend/          ← existing React app (shared)
├── backend/           ← existing Rust API (deployed separately)
├── desktop/           ← NEW: Tauri shell
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── src/
│   │   │   └── main.rs
│   │   └── icons/
│   └── package.json   ← points to ../frontend
```

## Features (Desktop-Only Enhancements)
1. **System Tray** — Quick access, notification badges
2. **Global Shortcut** — `Cmd+Shift+B` to open Baaton from anywhere
3. **Native Notifications** — OS-level notifications for assigned issues, comments
4. **Deep Links** — `baaton://issue/HLM-18` opens directly in app
5. **Auto-Update** — Tauri updater with signature verification
6. **Offline Queue** — Cache recent data, queue mutations for when online

## Build & Distribution
- macOS: DMG + .app (universal binary arm64+x86_64)
- Windows: MSI + NSIS installer
- Linux: AppImage + .deb

## Timeline
- Phase 1: Basic Tauri wrapper (1 day)
- Phase 2: System tray + notifications (1 day)
- Phase 3: Deep links + auto-update (1 day)
- Phase 4: Offline queue (2 days)

## Commands
```bash
cd desktop
npm install
npm run tauri dev    # Dev with hot reload
npm run tauri build  # Production build
```
