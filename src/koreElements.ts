import * as vscode from 'vscode';

export interface KoreElement {
	name: string;
	type: 'datapack' | 'function';
	range: vscode.Range;
	uri: vscode.Uri;
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

	public getElements(): KoreElement[] {
		return [...this.elements];
	}

	public getElementsByType(type: 'datapack' | 'function'): KoreElement[] {
		return this.elements.filter(element => element.type === type);
	}
}

// Singleton instance
export const koreElementManager = new KoreElementManager();
