import { app, session } from "electron";
import { settings } from "./settings.js";

// Well-known remote instances that already serve correct COOP/COEP headers
// from the server.  We skip these to avoid breaking cross-origin asset
// loading if their sub-resources lack CORP headers.
const REMOTE_ORIGINS_WITH_HEADERS = new Set(["https://penpot.app"]);

const LOCAL_ORIGINS = new Set(["http://localhost", "http://127.0.0.1"]);

/**
 * Check whether a request URL belongs to an instance that needs injected
 * COOP/COEP headers.  Evaluated on every response so that it stays in sync
 * when users add, remove, or change instance origins at runtime.
 *
 * @param {string} url
 */
function needsHeaderInjection(url) {
	let origin;
	try {
		origin = new URL(url).origin;
	} catch {
		return false;
	}

	if (REMOTE_ORIGINS_WITH_HEADERS.has(origin)) {
		return false;
	}

	if (LOCAL_ORIGINS.has(origin)) {
		return true;
	}

	return settings.instances.some((instance) => instance.origin === origin);
}

/**
 * Sets up performance-related HTTP response header modifications for all
 * Electron sessions, including partition sessions used by webview tabs.
 *
 * Injects Cross-Origin-Opener-Policy (COOP) and Cross-Origin-Embedder-Policy
 * (COEP) response headers for local Penpot instances. These two headers are
 * required by browsers/Chromium to enable SharedArrayBuffer, which Penpot
 * uses for multithreaded WASM rendering via its Rust/CanvasKit (Skia) pipeline.
 *
 * Without them, Penpot silently falls back to a single-threaded WASM path
 * which is noticeably slower on complex designs.
 *
 * Must be called after `app.whenReady()`.
 */
export function setupPerformanceHeaders() {
	// Cover the shell UI renderer and any session created before a webview
	// first uses its partition.
	applyHeadersToSession(session.defaultSession);

	// Cover every persist:<instanceId> partition session that is created
	// on-demand when a webview tab first loads.  The listener is registered
	// here (after app.whenReady) so the session module is available; all
	// partition sessions are created later, when the renderer creates webviews.
	app.on("session-created", (newSession) => {
		applyHeadersToSession(newSession);
	});
}

/**
 * Attaches a `webRequest.onHeadersReceived` handler to the given session that
 * injects COOP and COEP headers into HTML document responses served from
 * local or self-hosted Penpot instances.
 *
 * @param {import("electron").Session} targetSession
 */
function applyHeadersToSession(targetSession) {
	targetSession.webRequest.onHeadersReceived((details, callback) => {
		if (!needsHeaderInjection(details.url)) {
			return callback({});
		}

		const responseHeaders = { ...details.responseHeaders };

		// Header names in Electron's webRequest are case-sensitive and
		// may be lowercase depending on the server.  Check both casings.
		const contentType =
			responseHeaders["content-type"]?.[0] ??
			responseHeaders["Content-Type"]?.[0] ??
			"";
		const isHtmlDocument = contentType.includes("text/html");

		if (isHtmlDocument) {
			responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
			responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
		}

		callback({ responseHeaders });
	});
}
