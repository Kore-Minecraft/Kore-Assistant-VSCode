import * as vscode from 'vscode';
import { displayNameFor, isFunctionKind, kindById } from './koreDeclarations';
import { koreElementManager, ResolvedKoreElement, UNKNOWN_DATA_PACK } from './koreElements';
import * as path from 'node:path';

export class KoreTreeDataProvider implements vscode.TreeDataProvider<KoreTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<KoreTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<KoreTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	private _groupByFile: boolean = false;
	private _sortByFile: boolean = true;

	constructor(private readonly extensionUri: vscode.Uri, groupByFile: boolean = false, sortByFile: boolean = true) {
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
				return Promise.resolve(this.getDataPackRootItems());
			}
		} else if (element.contextValue === 'datapack') {
			// Datapack level - show kind categories for elements belonging to this datapack
			return Promise.resolve(this.getKindItemsForDataPack(element.dataPackName!));
		} else if (element.contextValue === 'category') {
			// Category level - show elements of this kind, scoped to the owning datapack
			return Promise.resolve(this.getItemsByKind(element.kindId, element.dataPackName));
		} else if (element.contextValue === 'group') {
			// Group level - show items within this path segment
			return Promise.resolve(this.getItemsInGroup(element));
		} else if (element.contextValue === 'file') {
			// File level - show items within this file
			return Promise.resolve(this.getItemsInFile(element));
		}

		return Promise.resolve([]);
	}

	// Root level when not "group by file": one node per datapack, containing every element resolved to it -
	// mirrors "a function lives inside a datapack", nested the way the IntelliJ plugin's tree shows it.
	private getDataPackRootItems(): KoreTreeItem[] {
		const elements = koreElementManager.getElements();
		const byDataPack = Map.groupBy(elements, element => element.resolvedDataPackName);

		const items: KoreTreeItem[] = [];
		for (const [dataPackName, dpElements] of byDataPack.entries()) {
			// If the datapack itself was found as a declaration, reuse its resolved paths/tooltip data.
			const ownDeclaration = dpElements.find(e => e.kindId === 'DATA_PACK' && e.name === dataPackName);

			items.push(new KoreTreeItem({
				label: dataPackName,
				contextValue: 'datapack',
				kindId: 'DATA_PACK',
				collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
				dataPackName,
				extensionUri: this.extensionUri,
				element: ownDeclaration,
			}));
		}

		return items.sort((a, b) => {
			if (a.label === UNKNOWN_DATA_PACK) {return 1;}
			if (b.label === UNKNOWN_DATA_PACK) {return -1;}
			return a.label!.toString().localeCompare(b.label!.toString());
		});
	}

	private getKindItemsForDataPack(dataPackName: string): KoreTreeItem[] {
		const elements = koreElementManager.getElements().filter(
			e => e.resolvedDataPackName === dataPackName && e.kindId !== 'DATA_PACK'
		);
		const byKind = Map.groupBy(elements, element => element.kindId);

		const items: KoreTreeItem[] = [];
		for (const [kindId, kindElements] of byKind.entries()) {
			if (kindElements.length === 0) {
				continue;
			}

			const kind = kindById(kindId);
			if (!kind) {
				continue;
			}

			items.push(new KoreTreeItem({
				label: displayNameFor(kind),
				contextValue: 'category',
				kindId,
				collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
				dataPackName,
			}));
		}

		return items.sort((a, b) => this.kindSortKey(a.kindId).localeCompare(this.kindSortKey(b.kindId)));
	}

	private getFileRootItems(): KoreTreeItem[] {
		const elements = koreElementManager.getElements();
		const fileGroups = Map.groupBy(elements, element => element.uri.fsPath);

		// Create tree items for each file
		const items: KoreTreeItem[] = [];
		for (const [filePath, fileElements] of fileGroups.entries()) {
			const fileName = path.basename(filePath);
			items.push(new KoreTreeItem({
				label: fileName,
				contextValue: 'file',
				kindId: '',
				collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
				fileData: { filePath, elements: fileElements },
			}));
		}

		// Sort files alphabetically
		return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
	}

	private getItemsInFile(fileItem: KoreTreeItem): KoreTreeItem[] {
		if (!fileItem.fileData) {return [];}

		const { elements } = fileItem.fileData;
		const items: KoreTreeItem[] = [];

		// Create tree items for each element in the file
		for (const element of elements) {
			items.push(this.createTreeItemFromElement(element));
		}

		// Sort items based on sorting preference
		return this.sortItems(items);
	}

	private getItemsByKind(kindId: string, dataPackName?: string): KoreTreeItem[] {
		const elements = koreElementManager.getElementsByKindId(kindId)
			.filter(e => dataPackName === undefined || e.resolvedDataPackName === dataPackName);

		// Group elements by their first path segment (elements without a path fall under '')
		const groups = Map.groupBy(elements, element => {
			const firstSlash = element.name.indexOf('/');
			return firstSlash === -1 ? '' : element.name.slice(0, firstSlash);
		});

		const items: KoreTreeItem[] = [];

		// Create tree items for direct elements (no path)
		for (const element of groups.get('') ?? []) {
			items.push(this.createTreeItemFromElement(element));
		}

		// Create tree items for groups
		for (const [groupName, groupElements] of groups.entries()) {
			if (groupName === '') {continue;} // Skip direct elements, already handled

			const pathElements = groupElements.map(e => e.name);
			items.push(new KoreTreeItem({
				label: groupName,
				contextValue: 'group',
				kindId,
				collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
				groupData: { kindId, pathPrefix: groupName, pathElements, dataPackName },
				dataPackName,
			}));
		}

		// Sort items based on sorting preference, adding separators between files if needed
		return this.finalizeItems(items);
	}

	private getItemsInGroup(groupItem: KoreTreeItem): KoreTreeItem[] {
		if (!groupItem.groupData) {return [];}

		const { pathPrefix, kindId, dataPackName } = groupItem.groupData;
		const items: KoreTreeItem[] = [];

		// Find all elements that match this prefix
		const relevantElements = koreElementManager.getElementsByKindId(kindId).filter(
			e => e.name.startsWith(pathPrefix + '/') && (dataPackName === undefined || e.resolvedDataPackName === dataPackName)
		);

		// Group by next path segment (direct children of this group fall under '')
		const subGroups = Map.groupBy(relevantElements, element => {
			const relativePath = element.name.slice(pathPrefix.length + 1);
			const nextSlash = relativePath.indexOf('/');
			return nextSlash === -1 ? '' : relativePath.slice(0, nextSlash);
		});

		// Add direct items
		for (const element of subGroups.get('') ?? []) {
			items.push(this.createTreeItemFromElement(element));
		}

		// Add subgroups
		for (const [groupName, groupElements] of subGroups.entries()) {
			if (groupName === '') {continue;} // Skip direct items, already handled

			const newPathPrefix = `${pathPrefix}/${groupName}`;
			items.push(new KoreTreeItem({
				label: groupName,
				contextValue: 'group',
				kindId,
				collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
				groupData: { kindId, pathPrefix: newPathPrefix, pathElements: groupElements.map(e => e.name), dataPackName },
				dataPackName,
			}));
		}

		// Sort items based on sorting preference, adding separators between files if needed
		return this.finalizeItems(items);
	}

	// Sorts items and, when sorting by file, inserts separators between groups of different files
	private finalizeItems(items: KoreTreeItem[]): KoreTreeItem[] {
		const sortedItems = this.sortItems(items);

		if (!this._sortByFile || sortedItems.length === 0) {
			return sortedItems;
		}

		const result: KoreTreeItem[] = [];
		let currentFileName: string | undefined;

		for (const item of sortedItems) {
			if (item.contextValue === 'element' && item.description) {
				const fileName = item.description.toString();

				if (currentFileName && fileName !== currentFileName) {
					result.push(new KoreTreeItem({
						label: '—'.repeat(10),
						contextValue: 'separator',
						kindId: '',
						collapsibleState: vscode.TreeItemCollapsibleState.None,
					}));
				}

				currentFileName = fileName;
			}

			result.push(item);
		}

		return result;
	}

	// DATA_PACK always sorts first (the container everything else groups under), the rest alphabetically by
	// display name - generalizes the old fixed "datapack before function" ordering to N categories.
	private kindSortKey(kindId: string): string {
		if (kindId === 'DATA_PACK') {
			return '';
		}
		const kind = kindById(kindId);
		return kind ? displayNameFor(kind) : kindId;
	}

	// Generic sorting function that handles both name and file based sorting
	private sortItems(items: KoreTreeItem[]): KoreTreeItem[] {
		if (this._sortByFile) {
			// Sort by file first, then by kind, then by name
			return items.sort((a, b) => {
				// Always put groups/folders first
				if (a.contextValue === 'group' && b.contextValue !== 'group') {return -1;}
				if (a.contextValue !== 'group' && b.contextValue === 'group') {return 1;}

				// If both items have a description (file path)
				if (a.description && b.description) {
					const fileCompare = a.description.toString().localeCompare(b.description.toString());
					if (fileCompare !== 0) {return fileCompare;}
				}

				// If same file or no file, sort by kind
				if (a.kindId !== b.kindId) {
					return this.kindSortKey(a.kindId).localeCompare(this.kindSortKey(b.kindId));
				}

				// If same kind, sort by name
				return a.label!.toString().localeCompare(b.label!.toString());
			});
		} else {
			// Sort by name only
			return items.sort((a, b) => {
				// Always put groups/folders first
				if (a.contextValue === 'group' && b.contextValue !== 'group') {return -1;}
				if (a.contextValue !== 'group' && b.contextValue === 'group') {return 1;}

				// Sort by kind
				if (a.kindId !== b.kindId) {
					return this.kindSortKey(a.kindId).localeCompare(this.kindSortKey(b.kindId));
				}

				// Finally, sort by name
				return a.label!.toString().localeCompare(b.label!.toString());
			});
		}
	}

	private createTreeItemFromElement(element: ResolvedKoreElement): KoreTreeItem {
		// Extract just the last part of the path for display
		const displayName = element.name.includes('/')
			? element.name.substring(element.name.lastIndexOf('/') + 1)
			: element.name;

		// Extract just the filename from the full URI path
		const filePath = element.uri.fsPath;
		const fileName = path.basename(filePath);

		// Get the line number
		const lineNumber = element.range.start.line;

		const kind = kindById(element.kindId);
		const relativeFilePath = this.tryGetWorkspaceRelativePath(filePath);

		const tooltipLines = [
			`${kind ? displayNameFor(kind) : element.kindId}: ${element.name}`,
		];
		if (kind?.id !== 'DATA_PACK') {
			tooltipLines.push(`Namespace: ${element.resolvedNamespace}`, `Data Pack: ${element.resolvedDataPackName}`);
		}
		tooltipLines.push(`File: ${relativeFilePath || fileName}`, `Line: ${lineNumber + 1}`);
		if (element.resourceLocation) {
			tooltipLines.push(`Resource Location: ${element.resourceLocation}`);
		}
		tooltipLines.push(`Output Path: ${element.outputPath}`);
		if (element.command) {
			tooltipLines.push(`Command: ${element.command}`);
		}
		if (element.isDynamic) {
			tooltipLines.push('Note: at least one part is computed at runtime, shown as its source snippet.');
		}

		const tooltip = tooltipLines.join('\n');

		return new KoreTreeItem({
			label: displayName,
			contextValue: 'element',
			kindId: element.kindId,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			command: {
				command: 'kore-assistant.revealKoreElement',
				title: 'Reveal Element',
				arguments: [element]
			},
			fileName,
			customTooltip: tooltip,
			lineNumber,
			extensionUri: this.extensionUri,
			element,
		});
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

interface KoreTreeItemOptions {
	label: string;
	contextValue: string;
	kindId: string;
	collapsibleState: vscode.TreeItemCollapsibleState;
	command?: vscode.Command;
	groupData?: {
		kindId: string;
		pathPrefix: string;
		pathElements: string[];
		dataPackName?: string;
	};
	fileName?: string;
	fileData?: {
		filePath: string;
		elements: ResolvedKoreElement[];
	};
	customTooltip?: string;
	lineNumber?: number;
	extensionUri?: vscode.Uri;
	element?: ResolvedKoreElement;
	dataPackName?: string;
}

export class KoreTreeItem extends vscode.TreeItem {
	public readonly contextValue: string;
	public readonly kindId: string;
	public readonly groupData?: KoreTreeItemOptions['groupData'];
	public readonly fileData?: KoreTreeItemOptions['fileData'];
	public readonly element?: ResolvedKoreElement;
	public readonly dataPackName?: string;

	constructor(options: KoreTreeItemOptions) {
		super(options.label, options.collapsibleState);

		this.contextValue = options.contextValue;
		this.kindId = options.kindId;
		this.command = options.command;
		this.groupData = options.groupData;
		this.fileData = options.fileData;
		this.element = options.element;
		this.dataPackName = options.dataPackName;

		const { fileName, lineNumber, customTooltip, extensionUri } = options;

		// Set file name as description (appears in gray after the label)
		if (fileName && options.contextValue !== 'separator') {
			// If we have a line number, add it in parentheses
			this.description = lineNumber !== undefined ? `${fileName} (${lineNumber + 1})` : fileName;
		}

		const kind = kindById(options.kindId);

		// Set icon based on kind and context
		if (options.contextValue === 'category') {
			this.iconPath = new vscode.ThemeIcon(categoryThemeIcon(kind));
			this.tooltip = kind ? `${displayNameFor(kind)} declarations in the workspace` : options.label;
		} else if (options.contextValue === 'element') {
			// Element icons - use custom icons from extension assets
			if (extensionUri && kind) {
				const iconName = elementIconName(kind);
				this.iconPath = {
					light: vscode.Uri.joinPath(extensionUri, 'dist', 'assets', `${iconName}-light.svg`),
					dark: vscode.Uri.joinPath(extensionUri, 'dist', 'assets', `${iconName}-dark.svg`)
				};
			}
			this.tooltip = customTooltip || options.label;
			this.contextValue = 'element';
		} else if (options.contextValue === 'datapack') {
			// Datapack root icons - reuse the same custom datapack icon as DATA_PACK elements
			if (extensionUri) {
				this.iconPath = {
					light: vscode.Uri.joinPath(extensionUri, 'dist', 'assets', 'datapack-light.svg'),
					dark: vscode.Uri.joinPath(extensionUri, 'dist', 'assets', 'datapack-dark.svg')
				};
			}
			this.tooltip = customTooltip ?? `Datapack: ${options.label}`;
		} else if (options.contextValue === 'group') {
			// Group icons
			this.iconPath = new vscode.ThemeIcon('folder');
			if (options.groupData && kind) {
				this.tooltip = `${displayNameFor(kind)} group: ${options.groupData.pathPrefix}`;
			}
		} else if (options.contextValue === 'file') {
			// File icons
			this.iconPath = new vscode.ThemeIcon('file-code');
			if (options.fileData) {
				const elementCount = options.fileData.elements.length;
				const datapackCount = options.fileData.elements.filter(e => e.kindId === 'DATA_PACK').length;
				const functionCount = options.fileData.elements.filter(e => {
					const k = kindById(e.kindId);
					return k ? isFunctionKind(k) : false;
				}).length;
				const otherCount = elementCount - datapackCount - functionCount;
				this.tooltip = `File: ${options.label}\nDatapacks: ${datapackCount}\nFunctions: ${functionCount}\nOther: ${otherCount}\nTotal elements: ${elementCount}`;
			}
		} else if (options.contextValue === 'separator') {
			// Style for separator - gray line
			this.description = '';

			// Empty tooltip
			this.tooltip = '';

			// Set a themed icon to show it's a separator
			this.iconPath = new vscode.ThemeIcon('dash');
		}
	}
}

function categoryThemeIcon(kind: ReturnType<typeof kindById>): string {
	if (!kind) {
		return 'symbol-misc';
	}
	if (kind.id === 'DATA_PACK') {
		return 'symbol-constructor';
	}
	return isFunctionKind(kind) ? 'symbol-function' : 'symbol-object';
}

// DATA_PACK keeps the Kore logo mark, function-family kinds keep the function glyph, and every other
// (JSON-backed) kind gets a generic braces icon rather than commissioning per-category art. See feature-parity-plan.md.
function elementIconName(kind: NonNullable<ReturnType<typeof kindById>>): string {
	if (kind.id === 'DATA_PACK') {
		return 'datapack';
	}
	return isFunctionKind(kind) ? 'function' : 'json';
}
