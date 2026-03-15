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
// Override Chromium's GPU blocklist so that all GPU optimisation flags below
// take effect even on hardware that Chromium would otherwise blacklist.
app.commandLine.appendSwitch("ignore-gpu-blocklist");

// Force GPU rasterization for Canvas 2D operations.  Penpot relies heavily on
// Canvas 2D for its design canvas, so moving rasterization off the CPU and
// onto the GPU has a direct impact on frame rate when scrolling, zooming, or
// manipulating objects.
app.commandLine.appendSwitch("enable-gpu-rasterization");

// Reduce the CPU↔GPU data-copy overhead during texture uploads.
app.commandLine.appendSwitch("enable-zero-copy");

// Use platform-native GPU memory buffers (IOSurface on macOS, DXGI on Windows)
// to further reduce CPU↔GPU data copies in conjunction with zero-copy above.
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

// Ensure hardware-accelerated 2D canvas is active even on machines where
// Chromium's GPU blocklist would otherwise disable it.
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");

// Move canvas rasterization into a dedicated GPU process so it cannot block
// the main renderer thread.
app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization");

// Remove the 60 fps cap so that high-refresh-rate displays (120 Hz / 144 Hz)
// can render Penpot's canvas at their native refresh rate.
app.commandLine.appendSwitch("disable-frame-rate-limit");

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

// ── V8 Heap ──────────────────────────────────────────────────────────────
// Penpot's ClojureScript runtime and WASM renderer can consume significant
// memory on large design files.  Raise the V8 old-generation heap limit from
// the default (~1.7 GB) to 4 GB to reduce GC pressure and avoid OOM crashes.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");

// ── Windows Occlusion ────────────────────────────────────────────────────
// On Windows, Chromium detects when a window is fully occluded by other
// windows and deprioritises its renderer.  Combined with the background-
// throttling switches below this ensures the renderer stays at full speed.
if (isWindows()) {
	app.commandLine.appendSwitch(
		"disable-features",
		"CalculateNativeWinOcclusion",
	);
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
