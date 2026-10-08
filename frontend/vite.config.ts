import react from "@vitejs/plugin-react";
import "dotenv/config";
import path from "node:path";
import { defineConfig, splitVendorChunkPlugin } from "vite";
import injectHTML from "vite-plugin-html-inject";
import tsConfigPaths from "vite-tsconfig-paths";

type Extension = {
	name: string;
	version: string;
	config: Record<string, unknown>;
};

enum ExtensionName {
	FIREBASE_AUTH = "firebase-auth",
	STACK_AUTH = "stack-auth"
}

const listExtensions = (): Extension[] => {
	if (process.env.DATABUTTON_EXTENSIONS) {
		try {
			return JSON.parse(process.env.DATABUTTON_EXTENSIONS) as Extension[];
		} catch (err: unknown) {
			console.error("Error parsing DATABUTTON_EXTENSIONS", err);
			console.error(process.env.DATABUTTON_EXTENSIONS);
			return [];
		}
	}

	return [];
};

const extensions = listExtensions();

// Fallbacks for builds outside Databutton, where DATABUTTON_EXTENSIONS is not set.
// The Firebase project matches the one hardcoded in src/app/auth/firebase.ts.
const defaultExtensionConfigs: Record<string, Record<string, unknown>> = {
	[ExtensionName.FIREBASE_AUTH]: {
		signInOptions: {
			google: true,
			github: false,
			facebook: false,
			twitter: false,
			emailAndPassword: true,
			magicLink: false,
		},
		siteName: "Q-ME",
		signInSuccessUrl: "/",
		firebaseConfig: {
			apiKey: "AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE",
			authDomain: "qmedata-7c79e.firebaseapp.com",
			projectId: "qmedata-7c79e",
			storageBucket: "qmedata-7c79e.firebasestorage.app",
			messagingSenderId: "189966000888",
			appId: "1:189966000888:web:73a249b8bacb35df2fd10d",
		},
	},
};

const getExtensionConfig = (name: string): string => {
	const extension = extensions.find((it) => it.name === name);

	if (!extension) {
		console.warn(`Extension ${name} not found, using default config`);
	}

	return JSON.stringify(extension?.config ?? defaultExtensionConfigs[name] ?? {});
};

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
		__STACK_AUTH_CONFIG__: JSON.stringify(getExtensionConfig(ExtensionName.STACK_AUTH)),
		__FIREBASE_CONFIG__: JSON.stringify(
			getExtensionConfig(ExtensionName.FIREBASE_AUTH),
		),
	};

	return defines;
};

// https://vite.dev/config/
export default defineConfig({
	define: buildVariables(),
	plugins: [react(), splitVendorChunkPlugin(), tsConfigPaths(), injectHTML()],
	server: {
		proxy: {
			"/routes": {
				target: "http://127.0.0.1:8000",
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
