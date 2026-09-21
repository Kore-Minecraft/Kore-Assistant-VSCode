import * as vscode from 'vscode';
import { commandFor, kindById, outputPathFor, resourceLocationFor } from './koreDeclarations';

/** Shown instead of a namespace/datapack name when the declaration sits outside any visible `dataPack { }`. */
export const UNKNOWN_DATA_PACK = '<unknown datapack>';

/** A Kore declaration as read straight from one file, before the workspace-wide sole-datapack fallback. */
export interface KoreElement {
	kindId: string;
	name: string;
	namespace?: string;
	dataPackName?: string;
	directory?: string;
	isDynamic: boolean;
	range: vscode.Range;
	uri: vscode.Uri;
}

/** A [KoreElement] with every path formula resolved, ready to display. */
export interface ResolvedKoreElement extends KoreElement {
	resolvedDataPackName: string;
	resolvedNamespace: string;
	outputPath: string;
	resourceLocation?: string;
	command?: string;
}

function resolveElement(element: KoreElement, soleDataPack: string | undefined): ResolvedKoreElement {
	const resolvedDataPackName = element.kindId === 'DATA_PACK' ? element.name : element.dataPackName ?? soleDataPack ?? UNKNOWN_DATA_PACK;
	const resolvedNamespace = element.namespace ?? resolvedDataPackName;

	const kind = kindById(element.kindId);
	const pathParts = { kind: kind!, name: element.name, namespace: resolvedNamespace, directory: element.directory };

	return {
		...element,
		resolvedDataPackName,
		resolvedNamespace,
		outputPath: outputPathFor(pathParts),
		resourceLocation: resourceLocationFor(pathParts),
		command: commandFor(pathParts),
	};
}

export class KoreElementManager {
	private readonly elementsByFile = new Map<string, KoreElement[]>();
	/** Resolved view of every file, rebuilt lazily after a change: the tree view asks for it once per node. */
	private resolved: ResolvedKoreElement[] | undefined;
	private readonly _onDidChangeElements = new vscode.EventEmitter<void>();
	readonly onDidChangeElements: vscode.Event<void> = this._onDidChangeElements.event;

	/** Swaps out every element of a file in one shot, firing a single change event instead of one per element. */
	public replaceElementsForUri(uri: vscode.Uri, elements: KoreElement[]): void {
		this.setFile(uri, elements);
		this.invalidate();
	}

	/** Same as [replaceElementsForUri] for many files at once, with one change event for the whole batch. */
	public replaceElementsForUris(entries: Iterable<readonly [vscode.Uri, KoreElement[]]>): void {
		for (const [uri, elements] of entries) {
			this.setFile(uri, elements);
		}
		this.invalidate();
	}

	public removeElementsForUris(uris: Iterable<vscode.Uri>): void {
		for (const uri of uris) {
			this.elementsByFile.delete(uri.fsPath);
		}
		this.invalidate();
	}

	private setFile(uri: vscode.Uri, elements: KoreElement[]): void {
		if (elements.length === 0) {
			this.elementsByFile.delete(uri.fsPath);
		} else {
			this.elementsByFile.set(uri.fsPath, elements);
		}
	}

	private invalidate(): void {
		this.resolved = undefined;
		this._onDidChangeElements.fire();
	}

	// If there's exactly one DATA_PACK declaration across the whole workspace, its name backs any element that
	// couldn't resolve a dataPackName locally (same "soleDataPack" fallback the IntelliJ plugin uses).
	private soleDataPackName(elements: KoreElement[]): string | undefined {
		const names = new Set(elements.filter(e => e.kindId === 'DATA_PACK').map(e => e.name));
		return names.size === 1 ? [...names][0] : undefined;
	}

	public getElements(): ResolvedKoreElement[] {
		if (!this.resolved) {
			const elements = [...this.elementsByFile.values()].flat();
			const soleDataPack = this.soleDataPackName(elements);
			this.resolved = elements.map(e => resolveElement(e, soleDataPack));
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
