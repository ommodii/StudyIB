# IB Science QBank — Xcode & iOS Deployment Guide

This guide explains how to build and deploy the **iOS mobile UI** using Capacitor and Xcode.

---

## Architecture Overview

The project has **two independent UI targets**:

| Target | Entry Point | Build Command | Output |
|---|---|---|---|
| **Desktop (Electron)** | `index.html` + `index.css` | `npm start` | Electron window |
| **iOS (Capacitor)** | `src/mobile/index.html` + `mobile.css` | `npm run build:ios` | `www/` → Xcode |

The desktop files are **never touched** when building for iOS. If you break something in the iOS UI you can delete `src/mobile/` and the desktop keeps working.

---

## Backup / Rollback

A full backup of all original frontend files is stored in `backup/`.

To restore the project to its original state:

```bash
cp backup/index.html ./
cp backup/app.js ./
cp backup/atom.js ./
cp backup/atom.css ./
cp backup/index.css ./
cp backup/gamification.js ./
cp backup/radar_chart.js ./
cp backup/build_web.js ./
cp backup/package.json ./
cp backup/capacitor.config.ts ./
```

---

## Step-by-Step: Build and Run on iOS

### 1. Build the Web Bundle

```bash
npm run build:ios
```

This runs `build_ios.js`, which:
- Cleans `www/`
- Copies all shared data/logic JS files from the project root
- Copies the mobile-specific HTML, CSS, and JS from `src/mobile/`
- Copies the `Content/` folder (PDFs)

**Expected output:**
```
✅  iOS build complete!  14 items copied, 0 warnings.
   Output: www/
```

### 2. Sync with Capacitor

```bash
npx cap sync ios
```

This copies `www/` into the iOS Xcode project and updates native plugins.

### 3. Open Xcode

```bash
npx cap open ios
```

Xcode will open the `ios/App/App.xcworkspace` file.

### 4. Select a Simulator or Device

- In Xcode's top toolbar, click the device dropdown (next to the play button)
- Select an **iPhone** (e.g., iPhone 15) or **iPad** (e.g., iPad Pro 12.9")
- Or connect a real device via USB and select it

### 5. Run the App

Click the **▶ Play** button (or press `⌘R`).

Xcode will build and install the app on the simulator or device.

---

## One-Line Build + Sync + Open

```bash
npm run build:ios:open
```

This chains all three steps automatically:
```
node build_ios.js && npx cap sync ios && npx cap open ios
```

---

## Testing the Mobile UI

After the app launches on the simulator:

| Test | What to Check |
|---|---|
| **Viewport height** | No content clipped by notch or home indicator |
| **Sidebar drawer** | Hamburger button (☰) opens sidebar from left; tap backdrop to close |
| **PDF viewer** | Tapping a paper card slides in the viewer; Close (✕) slides it back |
| **Scrolling** | Papers grid, PDF container, and modal bodies all scroll smoothly |
| **Drawing** | Pen/highlighter/eraser tools respond to Apple Pencil and finger |
| **Toolbar** | Viewer toolbar scrolls horizontally if too wide for the screen |
| **Safe area** | Content doesn't overlap the status bar (top) or home indicator (bottom) |
| **Rotate** | Rotate to landscape — layout adjusts, no clipping |

---

## Mobile UI Files

| File | Purpose |
|---|---|
| `src/mobile/index.html` | iOS-specific HTML (viewport-fit=cover, mobile layout) |
| `src/mobile/mobile.css` | iOS-first CSS (--vh fix, drawer, safe-area insets, 44px tap targets) |
| `src/mobile/app.mobile.js` | Viewport-height fix, sidebar drawer, touch→pointer bridge, Capacitor FS shim |
| `build_ios.js` | Build script that assembles `www/` for Capacitor |

---

## Desktop Build (unchanged)

```bash
npm start               # Run Electron desktop app
npm run build:desktop   # Build www/ for desktop (uses build_web.js)
npm run build:mac       # Package as .dmg
```

---

## Troubleshooting

### "Content security policy" error in simulator
The app loads PDFs from the `Content/` folder via relative paths. If you see CSP errors, add the following to `capacitor.config.ts`:
```ts
server: {
  allowNavigation: ['*']
}
```

### App is stuck on a white screen
Run `npx cap sync ios` again, then clean the build in Xcode: **Product → Clean Build Folder** (`⌘⇧K`).

### PDF pages are blank
PDF.js needs `pdfjs-dist/build/pdf.worker.js`. If using a bundler, ensure the worker URL is set correctly. The current setup loads it from CDN which requires an internet connection during development.

### Buttons not responding
Ensure `app.mobile.js` is loaded **before** `atom.js` and `app.js` in `src/mobile/index.html`. It installs the touch-to-pointer bridge and sidebar wiring before the main app runs.

### Scaling looks off on old iPads
The `--vh` CSS variable is updated on every `resize` and `orientationchange` event by `app.mobile.js`. If something still looks clipped, check that `mobile.css` is actually being loaded (not `index.css`).
