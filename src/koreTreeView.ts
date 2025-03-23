import * as vscode from 'vscode';
import { KoreElement, koreElementManager } from './koreElements';
import * as path from 'path';

export class KoreTreeDataProvider implements vscode.TreeDataProvider<KoreTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<KoreTreeItem | undefined | null | void> = new vscode.EventEmitter<KoreTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<KoreTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor() {
		// Listen for changes in elements and refresh the tree view
		koreElementManager.onDidChangeElements(() => {
			this.refresh();
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: KoreTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: KoreTreeItem): Thenable<KoreTreeItem[]> {
		if (!element) {
			// Root level - show datapack and function categories
			return Promise.resolve(this.getRootItems());
		} else if (element.contextValue === 'category') {
			// Category level - show datapack or function items
			return Promise.resolve(this.getItemsByCategory(element.type as 'datapack' | 'function'));
		} else if (element.contextValue === 'group') {
			// Group level - show items within this path segment
			return Promise.resolve(this.getItemsInGroup(element));
		}

		return Promise.resolve([]);
	}

	private getRootItems(): KoreTreeItem[] {
		const datapacks = koreElementManager.getElementsByType('datapack');
		const functions = koreElementManager.getElementsByType('function');

		const items: KoreTreeItem[] = [];

		if (datapacks.length > 0) {
			items.push(new KoreTreeItem(
				'Datapacks',
				'category',
				'datapack',
				vscode.TreeItemCollapsibleState.Expanded
			));
		}

		if (functions.length > 0) {
			items.push(new KoreTreeItem(
				'Functions',
				'category',
				'function',
				vscode.TreeItemCollapsibleState.Expanded
			));
		}

		return items;
	}

	private getItemsByCategory(type: 'datapack' | 'function'): KoreTreeItem[] {
		const elements = koreElementManager.getElementsByType(type);

		// Group items by their path segments
		const groups = new Map<string, KoreElement[]>();

		// First, organize elements into groups
		for (const element of elements) {
			const pathParts = element.name.split('/');

			if (pathParts.length === 1) {
				// No path, just add directly
				if (!groups.has('')) {
					groups.set('', []);
				}
				groups.get('')!.push(element);
			} else {
				// Has path, add to appropriate group
				const firstSegment = pathParts[0];
				if (!groups.has(firstSegment)) {
					groups.set(firstSegment, []);
				}
				groups.get(firstSegment)!.push(element);
			}
		}

		const items: KoreTreeItem[] = [];

		// Create tree items for direct elements (no path)
		if (groups.has('')) {
			for (const element of groups.get('')!) {
				items.push(this.createTreeItemFromElement(element));
			}
		}

		// Create tree items for groups
		for (const [groupName, groupElements] of groups.entries()) {
			if (groupName === '') continue; // Skip direct elements, already handled

			const pathElements = groupElements.map(e => e.name);
			items.push(new KoreTreeItem(
				groupName,
				'group',
				type,
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				{ type, pathPrefix: groupName, pathElements }
			));
		}

		// Sort items alphabetically
		return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
	}

	private getItemsInGroup(groupItem: KoreTreeItem): KoreTreeItem[] {
		if (!groupItem.groupData) return [];

		const { pathPrefix, pathElements, type } = groupItem.groupData;
		const items: KoreTreeItem[] = [];

		// Find all elements that match this prefix
		const relevantElements = koreElementManager.getElementsByType(type).filter(
			e => e.name.startsWith(pathPrefix + '/')
		);

		// Group by next path segment
		const subGroups = new Map<string, KoreElement[]>();
		const directItems: KoreElement[] = [];

		for (const element of relevantElements) {
			// Remove prefix and split the remaining path
			const relativePath = element.name.substring(pathPrefix.length + 1);
			const parts = relativePath.split('/');

			if (parts.length === 1) {
				// Direct child of this group
				directItems.push(element);
			} else {
				// Belongs to a subgroup
				const nextSegment = parts[0];
				if (!subGroups.has(nextSegment)) {
					subGroups.set(nextSegment, []);
				}
				subGroups.get(nextSegment)!.push(element);
			}
		}

		// Add direct items
		for (const element of directItems) {
			items.push(this.createTreeItemFromElement(element));
		}

		// Add subgroups
		for (const [groupName, groupElements] of subGroups.entries()) {
			const newPathPrefix = `${pathPrefix}/${groupName}`;
			items.push(new KoreTreeItem(
				groupName,
				'group',
				type,
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				{ type, pathPrefix: newPathPrefix, pathElements: groupElements.map(e => e.name) }
			));
		}

		// Sort items alphabetically
		return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
	}

	private createTreeItemFromElement(element: KoreElement): KoreTreeItem {
		// Extract just the last part of the path for display
		const displayName = element.name.includes('/')
			? element.name.substring(element.name.lastIndexOf('/') + 1)
			: element.name;

		return new KoreTreeItem(
			displayName,
			'element',
			element.type,
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'kore-assistant.revealKoreElement',
				title: 'Reveal Element',
				arguments: [element]
			}
		);
	}
}

export class KoreTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly contextValue: string,
		public readonly type: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly groupData?: {
			type: 'datapack' | 'function';
			pathPrefix: string;
			pathElements: string[];
		}
	) {
		super(label, collapsibleState);

		// Set icon based on type and context
		if (contextValue === 'category') {
			// Category icons
			this.iconPath = new vscode.ThemeIcon(type === 'datapack' ? 'package' : 'symbol-function');
		} else if (contextValue === 'element') {
			// Element icons - use custom icons from extension assets
			const iconName = type === 'datapack' ? 'datapack' : 'function';
			const lightIconPath = path.join(__filename, '..', '..', 'dist', 'assets', `${iconName}-light.svg`);
			const darkIconPath = path.join(__filename, '..', '..', 'dist', 'assets', `${iconName}-dark.svg`);
			this.iconPath = {
				light: vscode.Uri.file(lightIconPath),
				dark: vscode.Uri.file(darkIconPath)
			};
		} else if (contextValue === 'group') {
			// Group icons
			this.iconPath = new vscode.ThemeIcon('folder');
		}

		// Set description and tooltip
		if (contextValue === 'element' && label.includes('/')) {
			this.tooltip = label;
		}
	}
}
