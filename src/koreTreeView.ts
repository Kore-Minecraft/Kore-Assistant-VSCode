import * as vscode from 'vscode';
import { DATA_PACK_KIND, displayNameFor, isFunctionKind, kindById, outputPathFor } from './koreDeclarations';
import { koreElementManager, ResolvedKoreElement, UNKNOWN_DATA_PACK } from './koreElements';
import * as path from 'node:path';

/** Every value a tree item can put on the clipboard, one "Copy <Field>" context-menu entry per key. */
export interface CopyableValues {
	name?: string;
	namespace?: string;
	resourceLocation?: string;
	outputPath?: string;
	command?: string;
	filePath?: string;
	declarationPath?: string;
}

export type CopyableField = keyof CopyableValues;

type KoreTreeItemType = 'datapack' | 'category' | 'group' | 'file' | 'element' | 'separator';

/** `path/from/workspace.kt:line`, the form terminals and most editors open directly. */
function declarationPathOf(element: ResolvedKoreElement): string {
	return `${vscode.workspace.asRelativePath(element.uri, false)}:${element.range.start.line + 1}`;
}

/** Same tooltip for the tree item and the gutter hover: values render as code so they read as copy-ready. */
export function elementTooltip(element: ResolvedKoreElement): vscode.MarkdownString {
	const kind = kindById(element.kindId);
	const lines = [`**${kind ? displayNameFor(kind) : element.kindId}** \`${element.name}\``];
	if (element.kindId !== 'DATA_PACK') {
		lines.push(`Namespace: \`${element.resolvedNamespace}\``, `Data Pack: \`${element.resolvedDataPackName}\``);
	}
	lines.push(`File: \`${declarationPathOf(element)}\``);
	if (element.resourceLocation) {
		lines.push(`Resource Location: \`${element.resourceLocation}\``);
	}
	lines.push(`Output Path: \`${element.outputPath}\``);
	if (element.command) {
		lines.push(`Command: \`${element.command}\``);
	}
	if (element.isDynamic) {
		lines.push('_At least one part is computed at runtime, shown as its source snippet._');
	}
	return new vscode.MarkdownString(lines.join('  \n'));
}

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
		} else if (element.type === 'datapack') {
			// Datapack level - show kind categories for elements belonging to this datapack
			return Promise.resolve(this.getKindItemsForDataPack(element.dataPackName!));
		} else if (element.type === 'category') {
			// Category level - show elements of this kind, scoped to the owning datapack
			return Promise.resolve(this.getItemsByKind(element.kindId, element.dataPackName));
		} else if (element.type === 'group') {
			// Group level - show items within this path segment
			return Promise.resolve(this.getItemsInGroup(element));
		} else if (element.type === 'file') {
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
				type: 'datapack',
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
				type: 'category',
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
				type: 'file',
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
				type: 'group',
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
				type: 'group',
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
			if (item.element) {
				const fileName = item.element.uri.fsPath;

				if (currentFileName && fileName !== currentFileName) {
					result.push(new KoreTreeItem({
						label: '—'.repeat(10),
						type: 'separator',
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

	// DATA_PACK always sorts first (the container everything else groups under), the rest by resource folder then
	// display name, so the 60+ configured feature kinds or the 20 recipe kinds stay clustered together.
	private kindSortKey(kindId: string): string {
		if (kindId === 'DATA_PACK') {
			return '';
		}
		const kind = kindById(kindId);
		return kind ? `${kind.resourceFolder}/${displayNameFor(kind)}` : kindId;
	}

	// Groups first, then (when sorting by file) the file path, then kind, then name.
	private sortItems(items: KoreTreeItem[]): KoreTreeItem[] {
		return items.sort((a, b) => {
			if (a.type === 'group' && b.type !== 'group') {return -1;}
			if (a.type !== 'group' && b.type === 'group') {return 1;}

			if (this._sortByFile && a.element && b.element) {
				const fileCompare = a.element.uri.fsPath.localeCompare(b.element.uri.fsPath);
				if (fileCompare !== 0) {return fileCompare;}
			}

			if (a.kindId !== b.kindId) {
				return this.kindSortKey(a.kindId).localeCompare(this.kindSortKey(b.kindId));
			}

			return a.label!.toString().localeCompare(b.label!.toString());
		});
	}

	private createTreeItemFromElement(element: ResolvedKoreElement): KoreTreeItem {
		// Extract just the last part of the path for display
		const displayName = element.name.includes('/')
			? element.name.substring(element.name.lastIndexOf('/') + 1)
			: element.name;

		return new KoreTreeItem({
			label: displayName,
			type: 'element',
			kindId: element.kindId,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			command: {
				command: 'kore-assistant.revealKoreElement',
				title: 'Reveal Element',
				arguments: [element]
			},
			extensionUri: this.extensionUri,
			element,
		});
	}
}

interface KoreTreeItemOptions {
	label: string;
	type: KoreTreeItemType;
	kindId: string;
	collapsibleState: vscode.TreeItemCollapsibleState;
	command?: vscode.Command;
	groupData?: {
		kindId: string;
		pathPrefix: string;
		pathElements: string[];
		dataPackName?: string;
	};
	fileData?: {
		filePath: string;
		elements: ResolvedKoreElement[];
	};
	extensionUri?: vscode.Uri;
	element?: ResolvedKoreElement;
	dataPackName?: string;
}

// What each node can copy. A datapack root only knows its output folder when it resolved to a real name, and its
// source only when its `dataPack("x") { }` declaration was found; categories and groups copy the folder they map to.
function copyableValues(options: KoreTreeItemOptions): CopyableValues {
	const { type, element, dataPackName, groupData, fileData } = options;
	const kind = kindById(options.kindId);
	const namespace = dataPackName !== UNKNOWN_DATA_PACK ? dataPackName : undefined;

	switch (type) {
		case 'element':
			return {
				name: element!.name,
				namespace: element!.kindId === 'DATA_PACK' ? undefined : element!.resolvedNamespace,
				resourceLocation: element!.resourceLocation,
				outputPath: element!.outputPath,
				command: element!.command,
				filePath: element!.uri.fsPath,
				declarationPath: declarationPathOf(element!),
			};
		case 'datapack':
			return {
				name: namespace,
				namespace,
				outputPath: namespace && outputPathFor({ kind: DATA_PACK_KIND, name: namespace, namespace }),
				filePath: element?.uri.fsPath,
				declarationPath: element && declarationPathOf(element),
			};
		case 'category':
			return {
				name: options.label,
				namespace,
				outputPath: namespace && kind && `data/${namespace}/${kind.resourceFolder}`,
			};
		case 'group':
			return {
				name: groupData!.pathPrefix,
				namespace,
				outputPath: namespace && kind && `data/${namespace}/${kind.resourceFolder}/${groupData!.pathPrefix}`,
			};
		case 'file':
			return {
				name: options.label,
				filePath: fileData!.filePath,
				declarationPath: vscode.workspace.asRelativePath(fileData!.filePath, false),
			};
		case 'separator':
			return {};
	}
}

export class KoreTreeItem extends vscode.TreeItem {
	public readonly type: KoreTreeItemType;
	/** `<type> <field>...`: the `view/item/context` when-clauses regex-match the fields to show only the copyable ones. */
	public readonly contextValue: string;
	public readonly kindId: string;
	public readonly groupData?: KoreTreeItemOptions['groupData'];
	public readonly fileData?: KoreTreeItemOptions['fileData'];
	public readonly element?: ResolvedKoreElement;
	public readonly dataPackName?: string;
	public readonly values: CopyableValues;

	constructor(options: KoreTreeItemOptions) {
		super(options.label, options.collapsibleState);

		this.type = options.type;
		this.kindId = options.kindId;
		this.command = options.command;
		this.groupData = options.groupData;
		this.fileData = options.fileData;
		this.element = options.element;
		this.dataPackName = options.dataPackName;
		this.values = Object.fromEntries(Object.entries(copyableValues(options)).filter(([, value]) => value));
		this.contextValue = [options.type, ...Object.keys(this.values)].join(' ');

		const { extensionUri, element } = options;
		const kind = kindById(options.kindId);

		const assetIcon = (name: string) => ({
			light: vscode.Uri.joinPath(extensionUri!, 'dist', 'assets', `${name}-light.svg`),
			dark: vscode.Uri.joinPath(extensionUri!, 'dist', 'assets', `${name}-dark.svg`),
		});

		switch (options.type) {
			case 'category':
				this.iconPath = new vscode.ThemeIcon(categoryThemeIcon(kind));
				this.tooltip = kind ? `${displayNameFor(kind)} declarations in the workspace` : options.label;
				break;
			case 'element':
				if (extensionUri && kind) {
					this.iconPath = assetIcon(elementIconName(kind));
				}
				this.description = `${path.basename(element!.uri.fsPath)} (${element!.range.start.line + 1})`;
				this.tooltip = elementTooltip(element!);
				break;
			case 'datapack':
				if (extensionUri) {
					this.iconPath = assetIcon('datapack');
				}
				this.tooltip = element ? elementTooltip(element) : `Datapack: ${options.label}`;
				break;
			case 'group':
				this.iconPath = new vscode.ThemeIcon('folder');
				if (options.groupData && kind) {
					this.tooltip = `${displayNameFor(kind)} group: ${options.groupData.pathPrefix}`;
				}
				break;
			case 'file':
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
				break;
			case 'separator':
				this.tooltip = '';
				this.iconPath = new vscode.ThemeIcon('dash');
				break;
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
