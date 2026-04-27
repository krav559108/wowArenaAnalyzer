# WoW Arena Recorder

Automatically records your World of Warcraft arena matches. Detects when you enter an arena, starts recording, and saves a trimmed video with a timeline of key events — CC, defensives, interrupts, deaths.

Supports **2v2, 3v3, and Rated Solo Shuffle** (Midnight / patch 12.x format).

---

## Requirements

### macOS
- macOS 10.12 or later
- [FFmpeg](https://ffmpeg.org) — install via Homebrew: `brew install ffmpeg`
- Screen Recording permission (the app will prompt you during onboarding)

### Windows
- Windows 10 x64 or later
- [FFmpeg](https://ffmpeg.org/download.html) — download a build (e.g. from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)), extract and either add `bin/` to your system PATH or place `ffmpeg.exe` at `C:\ffmpeg\bin\ffmpeg.exe`

---

## Installation

### Download a release (recommended)

Go to the [Releases](../../releases) page and download:

- **macOS** — `WoW Arena Recorder-x.x.x-universal.dmg` (works on both Apple Silicon and Intel)
- **Windows** — `WoW Arena Recorder Setup x.x.x.exe`

### macOS
1. Open the `.dmg` and drag **WoW Arena Recorder** into `/Applications`
2. On first launch macOS may show "unidentified developer" — right-click the app → Open to bypass this

### Windows
1. Run the installer `.exe`
2. Follow the setup wizard — you can choose the install directory

---

## In-Game Setting (required)

Advanced Combat Logging must be enabled in WoW, otherwise the app won't receive the data it needs.

**Esc → Options → System → Network tab → check "Advanced Combat Logging"**

This setting persists across sessions — you only need to set it once.

---

## WoW Addon (required)

The app ships with a companion addon called **ArenaRecorderCompanion**. It reads your character's name, class, and spec, and writes them to WoW's SavedVariables so the recorder knows who you are.

**Install the addon:**

The easiest way is through the app itself — on the onboarding screen (or in Settings → Addon) click **Install Addon**. The app will copy it directly into your WoW AddOns folder.

**Manual install:**

Copy the `ArenaRecorderCompanion` folder into:
- **macOS** — `/Applications/World of Warcraft/_retail_/Interface/AddOns/`
- **Windows** — `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns\`

**After installing:**

1. Launch World of Warcraft
2. Type `/reload` in chat (or log in/out)
3. The app status bar should show **Addon connected**

> Without the addon the recorder still works, but "could use" defensive suggestions on death events will not filter for your character specifically.

---

## First Launch & Onboarding

On first launch the app walks you through setup:

1. **WoW folder** — auto-detected; click Browse if WoW is installed in a non-default location
2. **Screen Recording permission** *(macOS only)* — the app will trigger the system prompt; grant access in System Settings → Privacy & Security → Screen Recording, then return to the app
3. **Addon** — install ArenaRecorderCompanion (see above)
4. **FFmpeg** — the app checks that FFmpeg is reachable; install it if the check fails

After completing onboarding, settings are saved and the app goes straight to the main view on future launches.

---

## How Recording Works

1. Open the app before queuing
2. Queue for any rated arena bracket
3. The app watches your combat log and **automatically starts recording** when you zone into an arena
4. When the match ends it stops recording, trims the video, generates a thumbnail, and adds it to the list
5. Click any recording to watch it with the event timeline

**Solo Shuffle** records the entire 6-round session as one file and splits the timeline per round.

---

## Settings

| Setting | Description |
|---------|-------------|
| WoW Path | Path to your WoW installation folder |
| Storage Path | Where recordings are saved (default: `~/Movies/WoWArenaRecorder` on macOS, `Videos\WoWArenaRecorder` on Windows) |
| Video Bitrate | Recording quality in kbps (default: 8000) |
| FPS | Frames per second (default: 30) |
| Resolution | Output resolution or `native` to match your display |
| Capture Device | Screen to capture *(macOS only)* |
| Audio Device | Capture game audio via a loopback device like [BlackHole](https://existential.audio/blackhole/) *(macOS only)* |
| Auto Cleanup | Automatically delete old recordings after N days or when storage exceeds N GB |

---

## Development

```bash
# Install dependencies
npm install

# Start in dev mode (hot reload)
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit

# Production build
npm run build:mac        # macOS DMG
npm run build:win        # Windows NSIS installer
```

### Project structure

```
src/
  main/          — Electron main process (combat log, recorder, storage, IPC)
  renderer/src/  — Vue 3 + Pinia UI
  shared/        — Types and constants shared between main and renderer
addon/
  ArenaRecorderCompanion/  — WoW addon (Lua)
tests/
  fixtures/      — Sample combat log files used by parser tests
```

---

## Releases

Releases are built automatically by GitHub Actions on every version tag push.  
To publish a new version:

```bash
# Bump version in package.json, then:
git tag v1.2.3
git push origin main --tags
```

GitHub Actions builds a universal macOS DMG and a Windows x64 installer and attaches them to the release automatically.
