import { app, session } from "electron";

// Only inject headers for local instances (Docker on localhost).
// Remote instances (e.g. penpot.app) already send correct COOP/COEP headers
// from the server; applying them to arbitrary remote origins could break
// cross-origin asset loading if those origins lack CORP headers on their
// sub-resources.
const LOCAL_INSTANCE_URLS = ["http://localhost/*", "http://127.0.0.1/*"];

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
 * localhost.
 *
 * @param {import("electron").Session} targetSession
 */
function applyHeadersToSession(targetSession) {
	targetSession.webRequest.onHeadersReceived(
		{ urls: LOCAL_INSTANCE_URLS },
		(details, callback) => {
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
		},
	);
}
