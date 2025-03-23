import * as vscode from 'vscode';

export interface KoreElement {
	name: string;
	type: 'datapack' | 'function';
	range: vscode.Range;
	uri: vscode.Uri;
}

export class KoreElementManager {
	private elements: KoreElement[] = [];
	private _onDidChangeElements: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeElements: vscode.Event<void> = this._onDidChangeElements.event;

	constructor() {
		// Initialize empty
	}

	public addElement(element: KoreElement): void {
		this.elements.push(element);
		this._onDidChangeElements.fire();
	}

	public removeElement(element: KoreElement): void {
		const index = this.elements.findIndex(e =>
			e.name === element.name &&
			e.type === element.type &&
			e.uri.fsPath === element.uri.fsPath
		);

		if (index !== -1) {
			this.elements.splice(index, 1);
			this._onDidChangeElements.fire();
		}
	}

	public clearElements(): void {
		this.elements = [];
		this._onDidChangeElements.fire();
	}

	public getElements(): KoreElement[] {
		return [...this.elements];
	}

	public getElementsByType(type: 'datapack' | 'function'): KoreElement[] {
		return this.elements.filter(element => element.type === type);
	}

	public getElementsByUri(uri: vscode.Uri): KoreElement[] {
		return this.elements.filter(element => element.uri.fsPath === uri.fsPath);
	}

	public getElementByName(name: string): KoreElement | undefined {
		return this.elements.find(element => element.name === name);
	}
}

// Singleton instance
export const koreElementManager = new KoreElementManager();
