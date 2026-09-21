import * as path from 'node:path';
import * as vscode from 'vscode';
import { DATA_PACK_KIND, displayNameFor, isFunctionKind, kindById, KoreDeclarationKind, outputPathFor } from './koreDeclarations';
import { koreElementManager, ResolvedKoreElement, UNKNOWN_DATA_PACK } from './koreElements';

/** Every value a tree item can put on the clipboard, one "Copy <Field>" context-menu entry per key. */
export interface CopyableValues {
	command?: string;
	declarationPath?: string;
	filePath?: string;
	name?: string;
	namespace?: string;
	outputPath?: string;
	resourceLocation?: string;
}

export type CopyableField = keyof CopyableValues;

type KoreTreeItemType = 'category' | 'datapack' | 'element' | 'file' | 'group' | 'separator';

interface KoreTreeItemOptions {
	collapsibleState: vscode.TreeItemCollapsibleState;
	command?: vscode.Command;
	dataPackName?: string;
	element?: ResolvedKoreElement;
	extensionUri?: vscode.Uri;
	fileData?: {
		elements: ResolvedKoreElement[];
		filePath: string;
	};
	groupData?: {
		dataPackName?: string;
		kindId: string;
		pathPrefix: string;
	};
	kindId: string;
	label: string;
	type: KoreTreeItemType;
}

/**
 * DATA_PACK always sorts first (the container everything else groups under), the rest by resource folder then display
 * name, so the 60+ configured feature kinds or the 20 recipe kinds stay clustered together. Memoized: comparators call it.
 */
const KIND_SORT_KEYS = new Map<string, string>();
function kindSortKey(kindId: string): string {
	let key = KIND_SORT_KEYS.get(kindId);
	if (key === undefined) {
		const kind = kindById(kindId);
		key = kindId === 'DATA_PACK' ? '' : kind ? `${kind.resourceFolder}/${displayNameFor(kind)}` : kindId;
		KIND_SORT_KEYS.set(kindId, key);
	}
	return key;
}

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

function labelOf(item: KoreTreeItem): string {
	return item.label!.toString();
}

export class KoreTreeDataProvider implements vscode.TreeDataProvider<KoreTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<KoreTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<KoreTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor(private readonly extensionUri: vscode.Uri, private groupByFile = false, private sortByFile = true) {
		koreElementManager.onDidChangeElements(() => this.refresh());
	}

	getChildren(element?: KoreTreeItem): Thenable<KoreTreeItem[]> {
		return Promise.resolve(this.childrenOf(element));
	}

	getTreeItem(element: KoreTreeItem): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setGroupByFile(value: boolean): void {
		this.groupByFile = value;
	}

	setSortByFile(value: boolean): void {
		this.sortByFile = value;
	}

	private childrenOf(element?: KoreTreeItem): KoreTreeItem[] {
		switch (element?.type) {
			case undefined:
				return this.groupByFile ? this.getFileRootItems() : this.getDataPackRootItems();
			case 'datapack':
				return this.getKindItemsForDataPack(element.dataPackName!);
			case 'category':
				return this.getItemsByKind(element.kindId, element.dataPackName);
			case 'group':
				return this.getItemsInGroup(element);
			case 'file':
				return this.sortItems(element.fileData!.elements.map(e => this.createTreeItemFromElement(e)));
			default:
				return [];
		}
	}

	private createTreeItemFromElement(element: ResolvedKoreElement): KoreTreeItem {
		return new KoreTreeItem({
			label: element.name.slice(element.name.lastIndexOf('/') + 1),
			type: 'element',
			kindId: element.kindId,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			command: { command: 'kore-assistant.revealKoreElement', title: 'Reveal Element', arguments: [element] },
			extensionUri: this.extensionUri,
			element,
		});
	}

	/** Sorts items and, when sorting by file, inserts separators between groups of different files. */
	private finalizeItems(items: KoreTreeItem[]): KoreTreeItem[] {
		const sortedItems = this.sortItems(items);
		if (!this.sortByFile) {
			return sortedItems;
		}

		const result: KoreTreeItem[] = [];
		let currentFileName: string | undefined;
		for (const item of sortedItems) {
			if (item.element) {
				const fileName = item.element.uri.fsPath;
				if (currentFileName && fileName !== currentFileName) {
					result.push(new KoreTreeItem({ label: '—'.repeat(10), type: 'separator', kindId: '', collapsibleState: vscode.TreeItemCollapsibleState.None }));
				}
				currentFileName = fileName;
			}
			result.push(item);
		}
		return result;
	}

	/** One node per resolved datapack, containing every element resolved to it, nested the way the IntelliJ tree shows it. */
	private getDataPackRootItems(): KoreTreeItem[] {
		const byDataPack = Map.groupBy(koreElementManager.getElements(), element => element.resolvedDataPackName);
		const items = [...byDataPack].map(([dataPackName, dpElements]) => new KoreTreeItem({
			label: dataPackName,
			type: 'datapack',
			kindId: 'DATA_PACK',
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName,
			extensionUri: this.extensionUri,
			// When the datapack itself was found as a declaration, reuse its resolved paths/tooltip data.
			element: dpElements.find(e => e.kindId === 'DATA_PACK' && e.name === dataPackName),
		}));

		return items.sort((a, b) => {
			if (a.label === UNKNOWN_DATA_PACK) {
				return 1;
			}
			if (b.label === UNKNOWN_DATA_PACK) {
				return -1;
			}
			return labelOf(a).localeCompare(labelOf(b));
		});
	}

	private getFileRootItems(): KoreTreeItem[] {
		const fileGroups = Map.groupBy(koreElementManager.getElements(), element => element.uri.fsPath);
		const items = [...fileGroups].map(([filePath, elements]) => new KoreTreeItem({
			label: path.basename(filePath),
			type: 'file',
			kindId: '',
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			fileData: { filePath, elements },
		}));
		return items.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
	}

	/** Elements of one kind (and datapack) split into their first path segment, direct elements under `''`. */
	private getItemsByKind(kindId: string, dataPackName?: string): KoreTreeItem[] {
		const elements = koreElementManager.getElementsByKindId(kindId).filter(e => dataPackName === undefined || e.resolvedDataPackName === dataPackName);
		return this.groupedItems(elements, kindId, dataPackName, '');
	}

	private getItemsInGroup(groupItem: KoreTreeItem): KoreTreeItem[] {
		const { pathPrefix, kindId, dataPackName } = groupItem.groupData!;
		const prefix = `${pathPrefix}/`;
		const elements = koreElementManager.getElementsByKindId(kindId).filter(
			e => e.name.startsWith(prefix) && (dataPackName === undefined || e.resolvedDataPackName === dataPackName)
		);
		return this.groupedItems(elements, kindId, dataPackName, prefix);
	}

	private getKindItemsForDataPack(dataPackName: string): KoreTreeItem[] {
		const elements = koreElementManager.getElements().filter(e => e.resolvedDataPackName === dataPackName && e.kindId !== 'DATA_PACK');
		const items = [...Map.groupBy(elements, element => element.kindId).keys()].map(kindId => new KoreTreeItem({
			label: displayNameFor(kindById(kindId)!),
			type: 'category',
			kindId,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName,
		}));
		return items.sort((a, b) => kindSortKey(a.kindId).localeCompare(kindSortKey(b.kindId)));
	}

	/** Splits `elements` on the path segment following `prefix`: a group node per segment, a leaf per direct element. */
	private groupedItems(elements: ResolvedKoreElement[], kindId: string, dataPackName: string | undefined, prefix: string): KoreTreeItem[] {
		const groups = Map.groupBy(elements, element => {
			const nextSlash = element.name.indexOf('/', prefix.length);
			return nextSlash === -1 ? '' : element.name.slice(prefix.length, nextSlash);
		});

		const items = (groups.get('') ?? []).map(element => this.createTreeItemFromElement(element));
		for (const groupName of groups.keys()) {
			if (groupName !== '') {
				items.push(new KoreTreeItem({
					label: groupName,
					type: 'group',
					kindId,
					collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
					groupData: { kindId, pathPrefix: prefix + groupName, dataPackName },
					dataPackName,
				}));
			}
		}
		return this.finalizeItems(items);
	}

	/** Groups first, then (when sorting by file) the file path, then kind, then name. */
	private sortItems(items: KoreTreeItem[]): KoreTreeItem[] {
		return items.sort((a, b) => {
			if ((a.type === 'group') !== (b.type === 'group')) {
				return a.type === 'group' ? -1 : 1;
			}
			if (this.sortByFile && a.element && b.element) {
				const fileCompare = a.element.uri.fsPath.localeCompare(b.element.uri.fsPath);
				if (fileCompare !== 0) {
					return fileCompare;
				}
			}
			if (a.kindId !== b.kindId) {
				return kindSortKey(a.kindId).localeCompare(kindSortKey(b.kindId));
			}
			return labelOf(a).localeCompare(labelOf(b));
		});
	}
}

/**
 * What each node can copy. A datapack root only knows its output folder when it resolved to a real name, and its source
 * only when its `dataPack("x") { }` declaration was found; categories and groups copy the folder they map to.
 */
function copyableValues(options: KoreTreeItemOptions): CopyableValues {
	const { type, element, dataPackName, groupData, fileData } = options;
	const kind = kindById(options.kindId);
	const namespace = dataPackName !== UNKNOWN_DATA_PACK ? dataPackName : undefined;

	switch (type) {
		case 'element':
			return {
				command: element!.command,
				declarationPath: declarationPathOf(element!),
				filePath: element!.uri.fsPath,
				name: element!.name,
				namespace: element!.kindId === 'DATA_PACK' ? undefined : element!.resolvedNamespace,
				outputPath: element!.outputPath,
				resourceLocation: element!.resourceLocation,
			};
		case 'datapack':
			return {
				declarationPath: element && declarationPathOf(element),
				filePath: element?.uri.fsPath,
				name: namespace,
				namespace,
				outputPath: namespace && outputPathFor({ kind: DATA_PACK_KIND, name: namespace, namespace }),
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
				declarationPath: vscode.workspace.asRelativePath(fileData!.filePath, false),
				filePath: fileData!.filePath,
				name: options.label,
			};
		case 'separator':
			return {};
	}
}

export class KoreTreeItem extends vscode.TreeItem {
	/** `<type> <field>...`: the `view/item/context` when-clauses regex-match the fields to show only the copyable ones. */
	public readonly contextValue: string;
	public readonly dataPackName?: string;
	public readonly element?: ResolvedKoreElement;
	public readonly fileData?: KoreTreeItemOptions['fileData'];
	public readonly groupData?: KoreTreeItemOptions['groupData'];
	public readonly kindId: string;
	public readonly type: KoreTreeItemType;
	public readonly values: CopyableValues;

	constructor(options: KoreTreeItemOptions) {
		super(options.label, options.collapsibleState);

		this.command = options.command;
		this.dataPackName = options.dataPackName;
		this.element = options.element;
		this.fileData = options.fileData;
		this.groupData = options.groupData;
		this.kindId = options.kindId;
		this.type = options.type;
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
					const { elements } = options.fileData;
					const datapackCount = elements.filter(e => e.kindId === 'DATA_PACK').length;
					const functionCount = elements.filter(e => isFunctionKind(kindById(e.kindId)!)).length;
					const otherCount = elements.length - datapackCount - functionCount;
					this.tooltip = `File: ${options.label}\nDatapacks: ${datapackCount}\nFunctions: ${functionCount}\nOther: ${otherCount}\nTotal elements: ${elements.length}`;
				}
				break;
			case 'separator':
				this.tooltip = '';
				this.iconPath = new vscode.ThemeIcon('dash');
				break;
		}
	}
}

function categoryThemeIcon(kind: KoreDeclarationKind | undefined): string {
	if (!kind) {
		return 'symbol-misc';
	}
	if (kind.id === 'DATA_PACK') {
		return 'symbol-constructor';
	}
	return isFunctionKind(kind) ? 'symbol-function' : 'symbol-object';
}

/** DATA_PACK keeps the Kore logo mark, function-family kinds the function glyph, every other (JSON-backed) kind a braces icon. */
function elementIconName(kind: KoreDeclarationKind): string {
	if (kind.id === 'DATA_PACK') {
		return 'datapack';
	}
	return isFunctionKind(kind) ? 'function' : 'json';
}
