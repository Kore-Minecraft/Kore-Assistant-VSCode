import * as vscode from 'vscode';

export interface KoreElement {
	name: string;
	type: 'datapack' | 'function';
	range: vscode.Range;
	uri: vscode.Uri;
}

export class KoreElementManager {
	private elements: KoreElement[] = [];

	constructor() {
		// Initialize empty
	}

	public addElement(element: KoreElement): void {
		this.elements.push(element);
	}

	public clearElements(): void {
		this.elements = [];
	}

	public getElements(): KoreElement[] {
		return [...this.elements];
	}

	public getElementsByType(type: 'datapack' | 'function'): KoreElement[] {
		return this.elements.filter(element => element.type === type);
	}

	public getElementByName(name: string): KoreElement | undefined {
		return this.elements.find(element => element.name === name);
	}
}

// Singleton instance
export const koreElementManager = new KoreElementManager(); 
