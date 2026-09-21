import * as vscode from 'vscode';
import { commandFor, kindById, outputPathFor, resourceLocationFor } from './koreDeclarations';
import { type RawProblem, scanCraftingShapedBody } from './koreInspections';
import { parseKotlinFile, type RawFunctionCommand, type RawKoreDeclaration } from './koreParser';
import { KoreSourceFile, KoreWorkspaceResolver } from './koreResolver';
import { positionResolver, rangeOf } from './textPositions';

/** Shown instead of a namespace/datapack name when the declaration sits outside any visible `dataPack { }`. */
export const UNKNOWN_DATA_PACK = '<unknown datapack>';

/** Delay before rescanning a document after an edit, so a full-document scan doesn't run on every keystroke. */
export const RESCAN_DEBOUNCE_MS = 300;

/** A Kore declaration as read straight from one file, before the workspace-wide resolution. */
export interface KoreElement extends RawKoreDeclaration<vscode.Range> {
	/** The builder identifier, where the gutter icon and the tree reveal point. */
	range: vscode.Range;
	uri: vscode.Uri;
}

export interface KoreFunctionCommand extends RawFunctionCommand<vscode.Range> {
	uri: vscode.Uri;
}

export type KoreProblem = RawProblem<vscode.Range>;

/** A scanned file: its elements plus what the resolver and the diagnostics need from it. */
export interface KoreFile extends KoreSourceFile<KoreElement> {
	functionCommands: KoreFunctionCommand[];
	/** Per-file findings computed at scan time (`craftingShaped` grids), published as-is by the diagnostics. */
	problems: KoreProblem[];
}

/** A [KoreElement] with constants and datapack ownership resolved and every path formula applied, ready to display. */
export interface ResolvedKoreElement extends KoreElement {
	command?: string;
	outputPath: string;
	resolvedDataPackName: string;
	resolvedNamespace: string;
	resourceLocation?: string;
}

/** Wraps bare elements (tests, or files that failed to read) into a [KoreFile]. */
export function koreFileOf(source: KoreElement[] | KoreFile): KoreFile {
	if (!Array.isArray(source)) {
		return source;
	}
	return { calls: [], constants: [], dataPackBlocks: [], declaredFunctions: new Set(), declarations: source, extensionFunctions: [], functionCommands: [], problems: [] };
}

/** Scans a file's text for Kore DSL declarations, without touching the shared element store. */
export function parseKoreFile(text: string, uri: vscode.Uri): KoreFile {
	const positionAt = positionResolver(text);
	const parsed = parseKotlinFile(text);
	const problems: KoreProblem[] = [];
	const declarations = parsed.declarations.map((decl): KoreElement => {
		if (decl.kindId === 'CRAFTING_SHAPED' && decl.bodyRange) {
			for (const problem of scanCraftingShapedBody(text.slice(decl.bodyRange.start, decl.bodyRange.end), decl.bodyRange.start)) {
				problems.push({ ...problem, range: rangeOf(positionAt, problem.range) });
			}
		}
		const builderLength = kindById(decl.kindId)!.builderName.length;
		return {
			...decl,
			bodyRange: decl.bodyRange && rangeOf(positionAt, decl.bodyRange),
			nameArgRange: rangeOf(positionAt, decl.nameArgRange),
			range: new vscode.Range(positionAt(decl.offset), positionAt(decl.offset + builderLength)),
			uri,
		};
	});
	const functionCommands = parsed.functionCommands.map((command): KoreFunctionCommand => ({
		...command,
		argsRange: rangeOf(positionAt, command.argsRange),
		nameArgRange: rangeOf(positionAt, command.nameArgRange),
		namespaceArgRange: command.namespaceArgRange && rangeOf(positionAt, command.namespaceArgRange),
		uri,
	}));
	return { ...parsed, declarations, functionCommands, problems };
}

export class KoreElementManager {
	private readonly _onDidChangeElements = new vscode.EventEmitter<void>();
	private byKindId: Map<string, ResolvedKoreElement[]> | undefined;
	private byUri: Map<string, ResolvedKoreElement[]> | undefined;
	private readonly files = new Map<string, KoreFile>();
	readonly onDidChangeElements: vscode.Event<void> = this._onDidChangeElements.event;
	/** Resolved view of every file, rebuilt lazily after a change: the tree view asks for it once per node. */
	private resolved: ResolvedKoreElement[] | undefined;
	private resolver: KoreWorkspaceResolver | undefined;

	public getElements(): ResolvedKoreElement[] {
		if (!this.resolved) {
			const resolver = new KoreWorkspaceResolver(this.files);
			this.resolver = resolver;
			this.resolved = [...this.files].flatMap(([fsPath, file]) => file.declarations.map(element => {
				const strings = resolver.resolve(fsPath, element);
				const resolvedDataPackName = strings.dataPackName ?? UNKNOWN_DATA_PACK;
				const resolvedNamespace = strings.namespace ?? resolvedDataPackName;
				const pathParts = { kind: kindById(element.kindId)!, name: strings.name, namespace: resolvedNamespace, directory: strings.directory };

				return {
					...element,
					...strings,
					command: commandFor(pathParts),
					outputPath: outputPathFor(pathParts),
					resolvedDataPackName,
					resolvedNamespace,
					resourceLocation: resourceLocationFor(pathParts),
				};
			}));
		}
		return this.resolved;
	}

	public getElementsByKindId(kindId: string): ResolvedKoreElement[] {
		this.byKindId ??= Map.groupBy(this.getElements(), element => element.kindId);
		return this.byKindId.get(kindId) ?? [];
	}

	public getElementsForUri(uri: vscode.Uri): ResolvedKoreElement[] {
		this.byUri ??= Map.groupBy(this.getElements(), element => element.uri.fsPath);
		return this.byUri.get(uri.fsPath) ?? [];
	}

	public getFiles(): ReadonlyMap<string, KoreFile> {
		return this.files;
	}

	public removeElementsForUris(uris: Iterable<vscode.Uri>): void {
		for (const uri of uris) {
			this.files.delete(uri.fsPath);
		}
		this.invalidate();
	}

	/** Swaps out every element of a file in one shot, firing a single change event instead of one per element. */
	public replaceElementsForUri(uri: vscode.Uri, source: KoreElement[] | KoreFile): void {
		this.setFile(uri, source);
		this.invalidate();
	}

	/** Same as [replaceElementsForUri] for many files at once, with one change event for the whole batch. */
	public replaceElementsForUris(entries: Iterable<readonly [vscode.Uri, KoreElement[] | KoreFile]>): void {
		for (const [uri, source] of entries) {
			this.setFile(uri, source);
		}
		this.invalidate();
	}

	/** Follows a reference or template read at `offset` of the file through the workspace's constants, like a name would. */
	public resolveText(uri: vscode.Uri, text: string, offset: number): string | undefined {
		this.getElements();
		return this.resolver!.resolveString(uri.fsPath, text, offset);
	}

	private invalidate(): void {
		this.resolved = undefined;
		this.resolver = undefined;
		this.byKindId = undefined;
		this.byUri = undefined;
		this._onDidChangeElements.fire();
	}

	/** A file with no declarations still matters when it binds a constant or declares an extension function. */
	private setFile(uri: vscode.Uri, source: KoreElement[] | KoreFile): void {
		const file = koreFileOf(source);
		const empty = file.declarations.length === 0 && file.constants.length === 0 && file.extensionFunctions.length === 0 && file.calls.length === 0;
		if (empty) {
			this.files.delete(uri.fsPath);
		} else {
			this.files.set(uri.fsPath, file);
		}
	}
}

export const koreElementManager = new KoreElementManager();
