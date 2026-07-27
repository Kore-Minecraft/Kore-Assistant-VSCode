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
	const resolvedDataPackName = element.dataPackName ?? soleDataPack ?? UNKNOWN_DATA_PACK;
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
	private elements: KoreElement[] = [];
	private readonly _onDidChangeElements = new vscode.EventEmitter<void>();
	readonly onDidChangeElements: vscode.Event<void> = this._onDidChangeElements.event;

	// Swaps out every element for a given file in one shot, firing a single change event instead of one per element.
	public replaceElementsForUri(uri: vscode.Uri, elements: KoreElement[]): void {
		this.elements = this.elements.filter(e => e.uri.fsPath !== uri.fsPath).concat(elements);
		this._onDidChangeElements.fire();
	}

	// If there's exactly one DATA_PACK declaration across the whole workspace, its name backs any element that
	// couldn't resolve a dataPackName locally (same "soleDataPack" fallback the IntelliJ plugin uses).
	private soleDataPackName(): string | undefined {
		const names = new Set(this.elements.filter(e => e.kindId === 'DATA_PACK').map(e => e.name));
		return names.size === 1 ? [...names][0] : undefined;
	}

	public getElements(): ResolvedKoreElement[] {
		const soleDataPack = this.soleDataPackName();
		return this.elements.map(e => resolveElement(e, soleDataPack));
	}

	public getElementsByKindId(kindId: string): ResolvedKoreElement[] {
		return this.getElements().filter(element => element.kindId === kindId);
	}
}

// Singleton instance
export const koreElementManager = new KoreElementManager();
