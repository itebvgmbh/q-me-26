import react from "@vitejs/plugin-react";
import "dotenv/config";
import path from "node:path";
import type { GetModuleInfo } from "rollup";
import { defineConfig, type Plugin } from "vite";
import injectHTML from "vite-plugin-html-inject";
import tsConfigPaths from "vite-tsconfig-paths";
import { kopfHtml, OEFFENTLICHE_SEITEN } from "./src/utils/seiten-kopf";

const buildVariables = () => {
	const appId = process.env.DATABUTTON_PROJECT_ID;

	const defines: Record<string, string> = {
		__APP_ID__: JSON.stringify(appId),
		__API_PATH__: JSON.stringify(""),
		__API_HOST__: JSON.stringify(""),
		__API_PREFIX_PATH__: JSON.stringify(""),
		__API_URL__: JSON.stringify("http://localhost:8000"),
		__WS_API_URL__: JSON.stringify("ws://localhost:8000"),
		__APP_BASE_PATH__: JSON.stringify(""),
		__APP_TITLE__: JSON.stringify("Q-ME"),
		__APP_FAVICON_LIGHT__: JSON.stringify("/favicon-light.svg"),
		__APP_FAVICON_DARK__: JSON.stringify("/favicon-dark.svg"),
		__APP_DEPLOY_USERNAME__: JSON.stringify(""),
		__APP_DEPLOY_APPNAME__: JSON.stringify(""),
		__APP_DEPLOY_CUSTOM_DOMAIN__: JSON.stringify(""),
	};

	return defines;
};

const KOPF = /<!-- seiten-kopf[^>]*-->[\s\S]*?<!-- \/seiten-kopf -->/;
const kopfBlock = (pfad: string | null) => `<!-- seiten-kopf -->\n  ${kopfHtml(pfad)}\n  <!-- /seiten-kopf -->`;

// Eigene HTML-Datei je öffentlicher Seite (preise.html …) mit fertigem Kopf für Suchmaschinen und Link-Vorschauen,
// dazu app.html ohne Canonical für alle übrigen Adressen. Caddy: try_files {path} {path}.html /app.html (deploy/caddy-domain.py)
const seitenKoepfe = (): Plugin => ({
	name: "seiten-koepfe",
	enforce: "post",
	transformIndexHtml: (html) => html.replace(KOPF, kopfBlock("/")),
	generateBundle(_, bundle) {
		const index = bundle["index.html"];
		if (!index || index.type !== "asset") return;
		const html = String(index.source);
		for (const pfad of Object.keys(OEFFENTLICHE_SEITEN).filter((p) => p !== "/")) {
			this.emitFile({ type: "asset", fileName: `${pfad.slice(1)}.html`, source: html.replace(KOPF, kopfBlock(pfad)) });
		}
		this.emitFile({ type: "asset", fileName: "app.html", source: html.replace(KOPF, kopfBlock(null)) });
	},
});

// Bibliotheken in eigene Bausteine: Sie ändern sich selten und bleiben so nach einem Ausrollen im Browser-Cache.
// Firestore, Firebase (App, Auth) und React braucht jede Seite; die übrigen, die der Einstieg statisch lädt
// (Radix, lucide, sonner …), kommen in "vendor". Alles andere verteilt Rollup selbst: Leaflet kommt nur mit
// /shop-map, Firebase Storage nur mit den Seiten zum Bild-Hochladen. Messen: node dev/bundle-groesse.cjs
const BAUSTEINE: [string, RegExp][] = [
	["firestore", /\/node_modules\/(@firebase\/(firestore|webchannel-wrapper)|firebase\/firestore)\//],
	["firebase", /\/node_modules\/(@firebase\/(app|auth|component|logger|util)|firebase\/(app|auth)|idb)\//],
	["react", /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
	// Braucht Firebase und Radix. Läge es in "vendor", bekäme firebase bei jeder Änderung dort einen neuen Namen
	["tslib", /\/node_modules\/tslib\//],
];
const vomEinstieg = (id: string, info: GetModuleInfo, gesehen = new Set<string>()): boolean => {
	if (gesehen.has(id)) return false;
	gesehen.add(id);
	const modul = info(id);
	return !!modul && (modul.isEntry || modul.importers.some((importer) => vomEinstieg(importer, info, gesehen)));
};
// Ersetzt splitVendorChunkPlugin (veraltet; meldet in Vite 4.4 neben eigenen Bausteinen grundlos „no effect“)
const manualChunks = (id: string, { getModuleInfo }: { getModuleInfo: GetModuleInfo }) => {
	const pfad = id.replaceAll("\\", "/");
	if (!pfad.includes("/node_modules/") || /\.css($|\?)/.test(pfad)) return;
	return BAUSTEINE.find(([, muster]) => muster.test(pfad))?.[0] ?? (vomEinstieg(id, getModuleInfo) ? "vendor" : undefined);
};

// https://vite.dev/config/
export default defineConfig({
	define: buildVariables(),
	plugins: [react(), tsConfigPaths(), injectHTML(), seitenKoepfe()],
	build: {
		rollupOptions: { output: { manualChunks } },
	},
	server: {
		proxy: {
			// QME_BACKEND=https://dranzeit.de: lokales Frontend gegen das Backend auf dem Server testen
			"/routes": {
				target: process.env.QME_BACKEND || "http://127.0.0.1:8000",
				changeOrigin: true,
			},
		},
	},
	optimizeDeps: {
		exclude: ['firebase', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']
	},
	resolve: {
		// @firebase/auth and @firebase/firestore are not deduped: the only copies
		// in the tree are the ones firebase@10 depends on (nested under it), and
		// forcing root resolution used to pick stale v9-era copies instead.
		dedupe: [
			"firebase",
			"@firebase/app",
			"@firebase/storage",
			"@firebase/component"
		],
		alias: {
			"brain": path.resolve(__dirname, "./src/brain"),
			"components": path.resolve(__dirname, "./src/components"),
			"pages": path.resolve(__dirname, "./src/pages"),
			"app/auth": path.resolve(__dirname, "./src/app/auth"),
			"app": path.resolve(__dirname, "./src/app"),
			"utils": path.resolve(__dirname, "./src/utils"),
			"@/components/ui": path.resolve(__dirname, "./src/extensions/shadcn/components"),
			"@/components/hooks": path.resolve(__dirname, "./src/extensions/shadcn/hooks"),
			"@/hooks": path.resolve(__dirname, "./src/extensions/shadcn/hooks"),
			"@": path.resolve(__dirname, "./src")
		},
	},
});
