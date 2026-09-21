import * as vscode from 'vscode';
import { commandFor, kindById, outputPathFor, resourceLocationFor } from './koreDeclarations';
import type { KoreStringField, ParsedKotlinFile } from './koreParser';
import { KoreSourceFile, KoreWorkspaceResolver } from './koreResolver';

/** Shown instead of a namespace/datapack name when the declaration sits outside any visible `dataPack { }`. */
export const UNKNOWN_DATA_PACK = '<unknown datapack>';

/** A Kore declaration as read straight from one file, before the workspace-wide resolution. */
export interface KoreElement {
	kindId: string;
	name: string;
	namespace?: string;
	dataPackName?: string;
	directory?: string;
	enclosingFunction?: string;
	isDynamic: boolean;
	dynamicFields: KoreStringField[];
	range: vscode.Range;
	uri: vscode.Uri;
}

/** A scanned file: its elements plus what the resolver needs to follow constants and extension-function calls. */
export type KoreFile = KoreSourceFile<KoreElement>;

/** A [KoreElement] with constants and datapack ownership resolved and every path formula applied, ready to display. */
export interface ResolvedKoreElement extends KoreElement {
	resolvedDataPackName: string;
	resolvedNamespace: string;
	outputPath: string;
	resourceLocation?: string;
	command?: string;
}

/** Wraps bare elements (tests, or files scanned before the resolver inputs existed) into a [KoreFile]. */
export function koreFileOf(source: KoreElement[] | KoreFile): KoreFile {
	if (!Array.isArray(source)) {
		return source;
	}
	return { declarations: source, constants: new Map(), extensionFunctions: [], declaredFunctions: new Set(), dataPackBlocks: [], calls: [] };
}

export function koreFileFrom(parsed: ParsedKotlinFile, elements: KoreElement[]): KoreFile {
	return { ...parsed, declarations: elements };
}

export class KoreElementManager {
	private readonly files = new Map<string, KoreFile>();
	/** Resolved view of every file, rebuilt lazily after a change: the tree view asks for it once per node. */
	private resolved: ResolvedKoreElement[] | undefined;
	private readonly _onDidChangeElements = new vscode.EventEmitter<void>();
	readonly onDidChangeElements: vscode.Event<void> = this._onDidChangeElements.event;

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

	public removeElementsForUris(uris: Iterable<vscode.Uri>): void {
		for (const uri of uris) {
			this.files.delete(uri.fsPath);
		}
		this.invalidate();
	}

	// A file with no declarations still matters when it binds a constant or declares an extension function.
	private setFile(uri: vscode.Uri, source: KoreElement[] | KoreFile): void {
		const file = koreFileOf(source);
		const empty = file.declarations.length === 0 && file.constants.size === 0 && file.extensionFunctions.length === 0 && file.calls.length === 0;
		if (empty) {
			this.files.delete(uri.fsPath);
		} else {
			this.files.set(uri.fsPath, file);
		}
	}

	private invalidate(): void {
		this.resolved = undefined;
		this._onDidChangeElements.fire();
	}

	public getElements(): ResolvedKoreElement[] {
		if (!this.resolved) {
			const resolver = new KoreWorkspaceResolver(this.files);
			this.resolved = [...this.files].flatMap(([fsPath, file]) => file.declarations.map(element => {
				const strings = resolver.resolve(fsPath, element);
				const resolvedDataPackName = strings.dataPackName ?? UNKNOWN_DATA_PACK;
				const resolvedNamespace = strings.namespace ?? resolvedDataPackName;
				const kind = kindById(element.kindId)!;
				const pathParts = { kind, name: strings.name, namespace: resolvedNamespace, directory: strings.directory };

				return {
					...element,
					...strings,
					resolvedDataPackName,
					resolvedNamespace,
					outputPath: outputPathFor(pathParts),
					resourceLocation: resourceLocationFor(pathParts),
					command: commandFor(pathParts),
				};
			}));
		}
		return this.resolved;
	}

	public getElementsForUri(uri: vscode.Uri): ResolvedKoreElement[] {
		return this.getElements().filter(e => e.uri.fsPath === uri.fsPath);
	}

	public getElementsByKindId(kindId: string): ResolvedKoreElement[] {
		return this.getElements().filter(element => element.kindId === kindId);
	}
}

// Singleton instance
export const koreElementManager = new KoreElementManager();
