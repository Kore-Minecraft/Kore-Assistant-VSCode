import * as vscode from 'vscode';
import { KoreElement, koreElementManager } from './koreElements';
import * as path from 'path';

export class KoreTreeDataProvider implements vscode.TreeDataProvider<KoreTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<KoreTreeItem | undefined | null | void> = new vscode.EventEmitter<KoreTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<KoreTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	private _groupByFile: boolean = false;
	private _sortByFile: boolean = true;

	constructor(groupByFile: boolean = false, sortByFile: boolean = true) {
		this._groupByFile = groupByFile;
		this._sortByFile = sortByFile;

		// Listen for changes in elements and refresh the tree view
		koreElementManager.onDidChangeElements(() => {
			this.refresh();
		});
	}

	setGroupByFile(value: boolean): void {
		this._groupByFile = value;
	}

	setSortByFile(value: boolean): void {
		this._sortByFile = value;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: KoreTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: KoreTreeItem): Thenable<KoreTreeItem[]> {
		if (!element) {
			// Root level
			if (this._groupByFile) {
				return Promise.resolve(this.getFileRootItems());
			} else {
				return Promise.resolve(this.getTypeRootItems());
			}
		} else if (element.contextValue === 'category') {
			// Category level - show datapack or function items
			return Promise.resolve(this.getItemsByCategory(element.type as 'datapack' | 'function'));
		} else if (element.contextValue === 'group') {
			// Group level - show items within this path segment
			return Promise.resolve(this.getItemsInGroup(element));
		} else if (element.contextValue === 'file') {
			// File level - show items within this file
			return Promise.resolve(this.getItemsInFile(element));
		}

		return Promise.resolve([]);
	}

	private getTypeRootItems(): KoreTreeItem[] {
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

	private getFileRootItems(): KoreTreeItem[] {
		const elements = koreElementManager.getElements();
		const fileGroups = new Map<string, KoreElement[]>();

		// Group elements by file
		for (const element of elements) {
			const filePath = element.uri.fsPath;
			if (!fileGroups.has(filePath)) {
				fileGroups.set(filePath, []);
			}
			fileGroups.get(filePath)!.push(element);
		}

		// Create tree items for each file
		const items: KoreTreeItem[] = [];
		for (const [filePath, fileElements] of fileGroups.entries()) {
			const fileName = path.basename(filePath);
			items.push(new KoreTreeItem(
				fileName,
				'file',
				'file',
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				undefined,
				undefined,
				{ filePath, elements: fileElements }
			));
		}

		// Sort files alphabetically
		return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
	}

	private getItemsInFile(fileItem: KoreTreeItem): KoreTreeItem[] {
		if (!fileItem.fileData) return [];

		const { elements } = fileItem.fileData;
		const items: KoreTreeItem[] = [];

		// Create tree items for each element in the file
		for (const element of elements) {
			items.push(this.createTreeItemFromElement(element));
		}

		// Sort items based on sorting preference
		return this.sortItems(items);
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

		// Sort items based on sorting preference
		const sortedItems = this.sortItems(items);

		// If sorting by file, add separators between different files
		if (this._sortByFile && sortedItems.length > 0) {
			const result: KoreTreeItem[] = [];
			let currentFileName: string | undefined = undefined;

			for (const item of sortedItems) {
				if (item.contextValue === 'element' && item.description) {
					const fileName = item.description.toString();

					// If we're changing files, add a separator
					if (currentFileName && fileName !== currentFileName) {
						result.push(new KoreTreeItem(
							'—'.repeat(10),
							'separator',
							'separator',
							vscode.TreeItemCollapsibleState.None
						));
					}

					currentFileName = fileName;
				}

				result.push(item);
			}

			return result;
		}

		return sortedItems;
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

		// Sort items based on sorting preference
		const sortedItems = this.sortItems(items);

		// If sorting by file, add separators between different files
		if (this._sortByFile && sortedItems.length > 0) {
			const result: KoreTreeItem[] = [];
			let currentFileName: string | undefined = undefined;

			for (const item of sortedItems) {
				if (item.contextValue === 'element' && item.description) {
					const fileName = item.description.toString();

					// If we're changing files, add a separator
					if (currentFileName && fileName !== currentFileName) {
						result.push(new KoreTreeItem(
							'—'.repeat(10),
							'separator',
							'separator',
							vscode.TreeItemCollapsibleState.None
						));
					}

					currentFileName = fileName;
				}

				result.push(item);
			}

			return result;
		}

		return sortedItems;
	}

	// Generic sorting function that handles both name and file based sorting
	private sortItems(items: KoreTreeItem[]): KoreTreeItem[] {
		if (this._sortByFile) {
			// Sort by file first, then by type, then by name
			return items.sort((a, b) => {
				// Always put groups/folders first
				if (a.contextValue === 'group' && b.contextValue !== 'group') return -1;
				if (a.contextValue !== 'group' && b.contextValue === 'group') return 1;

				// If both items have a description (file path)
				if (a.description && b.description) {
					const fileCompare = a.description.toString().localeCompare(b.description.toString());
					if (fileCompare !== 0) return fileCompare;
				}

				// If same file or no file, sort by type
				if (a.type !== b.type) {
					return a.type === 'datapack' ? -1 : 1;
				}

				// If same type, sort by name
				return a.label!.toString().localeCompare(b.label!.toString());
			});
		} else {
			// Sort by name only
			return items.sort((a, b) => {
				// Always put groups/folders first
				if (a.contextValue === 'group' && b.contextValue !== 'group') return -1;
				if (a.contextValue !== 'group' && b.contextValue === 'group') return 1;

				// Sort by type
				if (a.type !== b.type) {
					return a.type === 'datapack' ? -1 : 1;
				}

				// Finally, sort by name
				return a.label!.toString().localeCompare(b.label!.toString());
			});
		}
	}

	private createTreeItemFromElement(element: KoreElement): KoreTreeItem {
		// Extract just the last part of the path for display
		const displayName = element.name.includes('/')
			? element.name.substring(element.name.lastIndexOf('/') + 1)
			: element.name;

		// Extract just the filename from the full URI path
		const filePath = element.uri.fsPath;
		const fileName = path.basename(filePath);

		// Get the line number
		const lineNumber = element.range.start.line;

		// Create a detailed tooltip with all information
		const relativeFilePath = this.tryGetWorkspaceRelativePath(filePath);
		const tooltipLines = [
			`${element.type === 'datapack' ? 'Datapack' : 'Function'}: ${element.name}`,
			`File: ${relativeFilePath || fileName}`,
			`Line: ${lineNumber + 1}`
		];
		const tooltip = tooltipLines.join('\n');

		return new KoreTreeItem(
			displayName,
			'element',
			element.type,
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'kore-assistant.revealKoreElement',
				title: 'Reveal Element',
				arguments: [element]
			},
			undefined,
			fileName,
			undefined,
			tooltip,
			lineNumber
		);
	}

	// Helper function to get workspace relative path if possible
	private tryGetWorkspaceRelativePath(absolutePath: string): string | undefined {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return undefined;
		}

		for (const folder of workspaceFolders) {
			const folderPath = folder.uri.fsPath;
			if (absolutePath.startsWith(folderPath)) {
				return absolutePath.substring(folderPath.length + 1); // +1 for the slash
			}
		}

		return undefined;
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
		},
		fileName?: string,
		public readonly fileData?: {
			filePath: string;
			elements: KoreElement[];
		},
		public readonly customTooltip?: string,
		private readonly lineNumber?: number
	) {
		super(label, collapsibleState);

		// Set file name as description (appears in gray after the label)
		if (fileName && contextValue !== 'separator') {
			// If we have a line number, add it in parentheses
			this.description = lineNumber !== undefined ? `${fileName} (${lineNumber + 1})` : fileName;
		}

		// Set icon based on type and context
		if (contextValue === 'category') {
			// Category icons
			this.iconPath = new vscode.ThemeIcon(type === 'datapack' ? 'symbol-constructor' : 'symbol-function');
			this.tooltip = type === 'datapack' ? 'Datapacks defined in the workspace' : 'Functions defined in the workspace';
		} else if (contextValue === 'element') {
			// Element icons - use custom icons from extension assets
			const iconName = type === 'datapack' ? 'datapack' : 'function';
			const lightIconPath = path.join(__filename, '..', '..', 'dist', 'assets', `${iconName}-light.svg`);
			const darkIconPath = path.join(__filename, '..', '..', 'dist', 'assets', `${iconName}-dark.svg`);
			this.iconPath = {
				light: vscode.Uri.file(lightIconPath),
				dark: vscode.Uri.file(darkIconPath)
			};
			this.tooltip = customTooltip || label;
		} else if (contextValue === 'group') {
			// Group icons
			this.iconPath = new vscode.ThemeIcon('folder');
			if (groupData) {
				this.tooltip = `${groupData.type === 'datapack' ? 'Datapack' : 'Function'} group: ${groupData.pathPrefix}`;
			}
		} else if (contextValue === 'file') {
			// File icons
			this.iconPath = new vscode.ThemeIcon('file-code');
			if (fileData) {
				const elementCount = fileData.elements.length;
				const datapackCount = fileData.elements.filter(e => e.type === 'datapack').length;
				const functionCount = fileData.elements.filter(e => e.type === 'function').length;
				this.tooltip = `File: ${label}\nDatapacks: ${datapackCount}\nFunctions: ${functionCount}\nTotal elements: ${elementCount}`;
			}
		} else if (contextValue === 'separator') {
			// Style for separator - gray line
			this.description = '';

			// Empty tooltip
			this.tooltip = '';

			// Set a themed icon to show it's a separator
			this.iconPath = new vscode.ThemeIcon('dash');
		}
	}
}
