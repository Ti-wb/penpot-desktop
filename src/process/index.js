import { app } from "electron";
import electronUpdater from "electron-updater";
import { MainWindow } from "./window.js";
import { isMacOs, isWindows } from "./platform.js";
import { setupPerformanceHeaders } from "./session.js";

await import("./instance.js");
await import("./file.js");
await import("./navigation.js");
await import("./diagnostics.js");

app.enableSandbox();

// ── GPU Rasterization ──────────────────────────────────────────────────────
// Force GPU rasterization for Canvas 2D operations.  Penpot relies heavily on
// Canvas 2D for its design canvas, so moving rasterization off the CPU and
// onto the GPU has a direct impact on frame rate when scrolling, zooming, or
// manipulating objects.
app.commandLine.appendSwitch("enable-gpu-rasterization");

// Reduce the CPU↔GPU data-copy overhead during texture uploads.
app.commandLine.appendSwitch("enable-zero-copy");

// Ensure hardware-accelerated 2D canvas is active even on machines where
// Chromium's GPU blocklist would otherwise disable it.
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");

// Move canvas rasterization into a dedicated GPU process so it cannot block
// the main renderer thread.
app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization");

// ── Platform-specific Rendering Backend ───────────────────────────────────
// Explicitly request the most capable native GPU API for the platform.
// While recent Electron versions default to these, being explicit avoids
// any regression from future default changes.
if (isMacOs()) {
	// Metal is the modern GPU API on macOS (replaces OpenGL).
	app.commandLine.appendSwitch("use-angle", "metal");
} else if (isWindows()) {
	// D3D11 outperforms the legacy D3D9 back-end on every modern Windows GPU.
	app.commandLine.appendSwitch("use-angle", "d3d11");
}

// ── Prevent Background Throttling ─────────────────────────────────────────
// By default Chromium throttles renderer processes that are backgrounded or
// hidden behind other windows.  For Penpot this causes autosave timers and
// ongoing network requests to slow down, and makes switching back to the
// window feel sluggish.  Disable all three throttling mechanisms.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// https://www.electronjs.org/docs/latest/breaking-changes#changed-gtk-4-is-default-when-running-gnome
// https://github.com/electron/electron/issues/46538
app.commandLine.appendSwitch("gtk-version", "3");

app.whenReady().then(() => {
	electronUpdater.autoUpdater.checkForUpdatesAndNotify();
	// Inject COOP/COEP headers for local instances to unlock SharedArrayBuffer
	// (required for Penpot's multithreaded WASM/Skia rendering pipeline).
	setupPerformanceHeaders();
	MainWindow.create();
});
