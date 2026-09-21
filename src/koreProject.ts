/**
 * Which Gradle/Maven projects of the workspace depend on Kore, and on which version, read from the build files
 * (IntelliJ reads the synced module libraries instead, see docs/feature-parity-plan.md section 4). Kore's own
 * repository has no Kore library, `:kore` is a source module: its `DataPack.kt` entry point marks it instead.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';

const KORE_GROUP = 'io.github.ayfri.kore';
export const BUILD_FILES_GLOB = '**/{build.gradle.kts,build.gradle,pom.xml,libs.versions.toml}';
export const KORE_SOURCES_GLOB = '**/io/github/ayfri/kore/DataPack.kt';
const BUILD_FILES_EXCLUDE = '**/{build,.gradle,.idea,node_modules}/**';
const BUILD_SCRIPT_NAMES = new Set(['build.gradle.kts', 'build.gradle']);
const CATALOG_NAME = 'libs.versions.toml';
const REFRESH_DEBOUNCE_MS = 500;

/** `io.github.ayfri.kore:kore:2.14.0-26.2` in a Gradle dependency or a short-form catalog entry. */
const DEPENDENCY_PATTERN = /io\.github\.ayfri\.kore:kore:([^"'\s]+)/;
/** `<groupId>io.github.ayfri.kore</groupId>` ... `<version>x</version>` of a Maven dependency. */
const MAVEN_PATTERN = /<groupId>\s*io\.github\.ayfri\.kore\s*<\/groupId>\s*<artifactId>\s*kore\s*<\/artifactId>\s*<version>\s*([^<\s]+)\s*<\/version>/;
/** `id("io.github.ayfri.kore") version "x"` in Kotlin or Groovy DSL. */
const PLUGIN_VERSION_PATTERN = /id\s*\(?\s*["']io\.github\.ayfri\.kore["']\s*\)?\s+version\s+["']([^"']+)["']/;
const PLUGINS_BLOCK_PATTERN = /\bplugins\s*\{([^}]*)\}/;
/** A catalog line naming Kore: `module = "io.github.ayfri.kore:kore"`, `group = "io.github.ayfri.kore"` or `id = "..."`. */
const CATALOG_ENTRY_PATTERN = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(\{[^}]*io\.github\.ayfri\.kore[^}]*\})/gm;
const CATALOG_VERSION_PATTERN = /\bversion\s*=\s*"([^"]+)"/;
const CATALOG_VERSION_REF_PATTERN = /\bversion\.ref\s*=\s*"([^"]+)"/;
const CATALOG_PLUGIN_ID_PATTERN = /\bid\s*=\s*"io\.github\.ayfri\.kore"/;

/**
 * Kore's Maven version is `<kore>-<minecraft>` (`2.14.0-26.2`), not plain semver: split on the LAST dash, never
 * compare the raw string as a semver. The Gradle plugin carries the same version, both are released together.
 */
export class KoreVersion {
	constructor(readonly kore: string, readonly minecraft: string) {}

	static parse(raw: string): KoreVersion | undefined {
		const separator = raw.lastIndexOf('-');
		return separator <= 0 || separator >= raw.length - 1 ? undefined : new KoreVersion(raw.slice(0, separator), raw.slice(separator + 1));
	}

	toString(): string {
		return `${this.kore}-${this.minecraft}`;
	}
}

/** What a build file says about Kore. */
export interface KoreBuildInfo {
	/** The Kore Gradle plugin is applied in `plugins { }`, directly or through a catalog alias. */
	hasGradlePlugin: boolean;
	version?: KoreVersion;
}

/** A Gradle/Maven project directory that depends on Kore. */
export interface KoreProject extends KoreBuildInfo {
	dir: string;
	/** Kore's own sources live under this project: a Kore project without a Kore library entry. */
	fromSources: boolean;
}

/** What a `libs.versions.toml` declares for Kore: the aliases a build script refers to, and the version behind them. */
export interface KoreCatalogInfo {
	/** `libs.<alias>` spellings of the Kore library, dashes and underscores turned into dots like Gradle does. */
	libraryAliases: string[];
	/** `libs.plugins.<alias>` spellings of the Kore Gradle plugin. */
	pluginAliases: string[];
	version?: KoreVersion;
}

export function parseVersionCatalog(text: string): KoreCatalogInfo {
	const info: KoreCatalogInfo = { libraryAliases: [], pluginAliases: [] };
	for (const [, alias, entry] of text.matchAll(CATALOG_ENTRY_PATTERN)) {
		const accessor = alias.replace(/[-_]/g, '.');
		if (CATALOG_PLUGIN_ID_PATTERN.test(entry)) {
			info.pluginAliases.push(`libs.plugins.${accessor}`);
		} else {
			info.libraryAliases.push(`libs.${accessor}`);
		}
		const ref = CATALOG_VERSION_REF_PATTERN.exec(entry)?.[1];
		const raw = CATALOG_VERSION_PATTERN.exec(entry)?.[1] ?? (ref && new RegExp(`^\\s*${ref.replace(/[.-]/g, '\\$&')}\\s*=\\s*"([^"]+)"`, 'm').exec(text)?.[1]);
		info.version ??= raw ? KoreVersion.parse(raw) : undefined;
	}
	const shortForm = DEPENDENCY_PATTERN.exec(text);
	if (shortForm) {
		const alias = /([A-Za-z0-9_.-]+)\s*=\s*"[^"]*$/.exec(text.slice(0, shortForm.index))?.[1];
		if (alias) {
			info.libraryAliases.push(`libs.${alias.replace(/[-_]/g, '.')}`);
		}
		info.version ??= KoreVersion.parse(shortForm[1]);
	}
	return info;
}

/** Reads a `build.gradle(.kts)` or `pom.xml`; `undefined` when it does not depend on Kore. */
export function parseBuildFile(text: string, catalog?: KoreCatalogInfo): KoreBuildInfo | undefined {
	const plugins = PLUGINS_BLOCK_PATTERN.exec(text)?.[1] ?? '';
	const hasGradlePlugin = plugins.includes(`"${KORE_GROUP}"`) || plugins.includes(`'${KORE_GROUP}'`) || (catalog?.pluginAliases.some(alias => plugins.includes(alias)) ?? false);
	const raw = DEPENDENCY_PATTERN.exec(text)?.[1] ?? MAVEN_PATTERN.exec(text)?.[1] ?? PLUGIN_VERSION_PATTERN.exec(text)?.[1];
	const version = raw ? KoreVersion.parse(raw) : undefined;
	const usesCatalog = catalog?.libraryAliases.some(alias => text.includes(alias)) ?? false;
	if (version === undefined && !hasGradlePlugin && !usesCatalog && !text.includes(KORE_GROUP)) {
		return undefined;
	}
	return { hasGradlePlugin, version: version ?? catalog?.version };
}

/**
 * Detects the Kore projects of the workspace from their build files, cached until a build file or a Kore source
 * changes, so every feature that needs the Kore version or the Gradle plugin can bail out on unrelated projects.
 */
export class KoreProjectService implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [];
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
	private projects = new Map<string, KoreProject>();
	private refreshTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		for (const glob of [BUILD_FILES_GLOB, KORE_SOURCES_GLOB]) {
			const watcher = vscode.workspace.createFileSystemWatcher(glob);
			this.disposables.push(watcher, watcher.onDidChange(() => this.scheduleRefresh()), watcher.onDidCreate(() => this.scheduleRefresh()), watcher.onDidDelete(() => this.scheduleRefresh()));
		}
		this.disposables.push(this._onDidChange);
	}

	get isKoreProject(): boolean {
		return this.projects.size > 0;
	}

	dispose(): void {
		clearTimeout(this.refreshTimeout);
		vscode.Disposable.from(...this.disposables).dispose();
	}

	getProjects(): ReadonlyMap<string, KoreProject> {
		return this.projects;
	}

	/** The Kore project a file belongs to: the nearest ancestor directory holding a build file that mentions Kore. */
	projectFor(uri: vscode.Uri): KoreProject | undefined {
		for (let dir = path.dirname(uri.fsPath); ; dir = path.dirname(dir)) {
			const project = this.projects.get(dir);
			if (project || path.dirname(dir) === dir) {
				return project;
			}
		}
	}

	async refresh(): Promise<void> {
		clearTimeout(this.refreshTimeout);
		const [buildFiles, sourceFiles] = await Promise.all([
			vscode.workspace.findFiles(BUILD_FILES_GLOB, BUILD_FILES_EXCLUDE),
			vscode.workspace.findFiles(KORE_SOURCES_GLOB, BUILD_FILES_EXCLUDE),
		]);
		const decoder = new TextDecoder();
		const texts = new Map(await Promise.all(buildFiles.map(async uri => [uri.fsPath, decoder.decode(await vscode.workspace.fs.readFile(uri))] as const)));

		// A catalog applies to the project holding its `gradle/` folder and to every subproject under it.
		const catalogs = new Map<string, KoreCatalogInfo>();
		for (const [fsPath, text] of texts) {
			if (path.basename(fsPath) === CATALOG_NAME) {
				const dir = path.dirname(fsPath);
				catalogs.set(path.basename(dir) === 'gradle' ? path.dirname(dir) : dir, parseVersionCatalog(text));
			}
		}
		const catalogFor = (dir: string): KoreCatalogInfo | undefined => {
			for (let current = dir; ; current = path.dirname(current)) {
				const catalog = catalogs.get(current);
				if (catalog || path.dirname(current) === current) {
					return catalog;
				}
			}
		};

		const projects = new Map<string, KoreProject>();
		for (const [fsPath, text] of texts) {
			const dir = path.dirname(fsPath);
			if (path.basename(fsPath) === CATALOG_NAME) {
				continue;
			}
			const info = parseBuildFile(text, BUILD_SCRIPT_NAMES.has(path.basename(fsPath)) ? catalogFor(dir) : undefined);
			if (info) {
				projects.set(dir, { dir, fromSources: false, ...info });
			}
		}

		const buildDirs = new Set([...texts.keys()].map(fsPath => path.dirname(fsPath)));
		for (const uri of sourceFiles) {
			const dir = nearestDirectory(uri.fsPath, buildDirs) ?? path.dirname(uri.fsPath);
			const existing = projects.get(dir);
			projects.set(dir, { dir, hasGradlePlugin: false, ...existing, fromSources: true });
		}

		this.projects = projects;
		this._onDidChange.fire();
	}

	private scheduleRefresh(): void {
		clearTimeout(this.refreshTimeout);
		this.refreshTimeout = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
	}
}

function nearestDirectory(fsPath: string, candidates: ReadonlySet<string>): string | undefined {
	for (let dir = path.dirname(fsPath); ; dir = path.dirname(dir)) {
		if (candidates.has(dir)) {
			return dir;
		}
		if (path.dirname(dir) === dir) {
			return undefined;
		}
	}
}
