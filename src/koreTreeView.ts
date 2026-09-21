import * as path from 'node:path';
import * as vscode from 'vscode';
import { DATA_PACK_KIND, displayNameFor, isFunctionKind, kindById, KoreDeclarationKind, outputPathFor } from './koreDeclarations';
import { koreElementManager, ResolvedKoreElement, UNKNOWN_DATA_PACK } from './koreElements';
import { declarationPathOf } from './textPositions';

/** How the flat element list turns into a tree. `output` mirrors the generated `data/<namespace>/<folder>/` layout. */
export type KoreGroupBy = 'output' | 'kind' | 'file' | 'flat';
export type KoreSortBy = 'name' | 'kind' | 'namespace' | 'declaration';
export type KoreSortOrder = 'asc' | 'desc';

export interface KoreViewOptions {
	/** Case-insensitive substring matched against the name, namespace and output path of every element. */
	filter: string;
	groupBy: KoreGroupBy;
	sortBy: KoreSortBy;
	sortOrder: KoreSortOrder;
}

export const DEFAULT_VIEW_OPTIONS: KoreViewOptions = { filter: '', groupBy: 'kind', sortBy: 'name', sortOrder: 'asc' };

/** Every value a tree item can put on the clipboard, one "Copy <Field>" context-menu entry per key. */
export interface CopyableValues {
	command?: string;
	declarationPath?: string;
	filePath?: string;
	name?: string;
	namespace?: string;
	outputPath?: string;
	/** One output path per element under a container row, newline-separated. */
	outputPaths?: string;
	resourceLocation?: string;
	/** One resource location per element under a container row that has one, newline-separated. */
	resourceLocations?: string;
}

export type CopyableField = keyof CopyableValues;

type KoreTreeItemType = 'category' | 'datapack' | 'element' | 'file' | 'folder' | 'group' | 'namespace' | 'separator';

interface KoreTreeItemOptions {
	collapsibleState: vscode.TreeItemCollapsibleState;
	command?: vscode.Command;
	dataPackName?: string;
	/** The declaration on a leaf, the `dataPack("x") { }` declaration on a datapack row when it was found. */
	element?: ResolvedKoreElement;
	/** Every element under a container row (the datapack declaration itself excluded), the leaf itself on a leaf. */
	elements: ResolvedKoreElement[];
	extensionUri?: vscode.Uri;
	filePath?: string;
	/** The `data/<namespace>/<folder>` a category, folder or path group writes under. */
	folder?: string;
	groupData?: {
		pathPrefix: string;
	};
	/** Unique across the tree: VS Code keeps the collapse state per id and `TreeView.reveal` finds rows by it. */
	id: string;
	kindId: string;
	label: string;
	namespace?: string;
	parent?: KoreTreeItem;
	type: KoreTreeItemType;
}

/** Long value lists turn a hover into a wall, so they are cut at this many entries plus a "+N more" tail. */
const MAX_LISTED = 8;

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

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

type ElementComparator = (a: ResolvedKoreElement, b: ResolvedKoreElement) => number;

const byName: ElementComparator = (a, b) => COLLATOR.compare(resourcePathOf(a), resourcePathOf(b)) || COLLATOR.compare(path.basename(a.uri.fsPath), path.basename(b.uri.fsPath));

/** Same criteria as the IntelliJ tool window; declaration order compares positions so two declarations on one line keep their source order. */
const COMPARATORS: Record<KoreSortBy, ElementComparator> = {
	name: byName,
	kind: (a, b) => COLLATOR.compare(kindSortKey(a.kindId), kindSortKey(b.kindId)) || byName(a, b),
	namespace: (a, b) => COLLATOR.compare(a.resolvedNamespace, b.resolvedNamespace) || byName(a, b),
	declaration: (a, b) => COLLATOR.compare(a.uri.fsPath, b.uri.fsPath) || a.range.start.compareTo(b.range.start),
};

/** The leaf's path inside its resource folder: a function's `directory` is a folder too, so `function("on_death", directory = "hearts")` sits under `hearts/`. */
function resourcePathOf(element: ResolvedKoreElement): string {
	const directory = element.directory?.replace(/\/+$/, '');
	return directory ? `${directory}/${element.name}` : element.name;
}

function matches(element: ResolvedKoreElement, filter: string): boolean {
	return element.name.toLowerCase().includes(filter) || element.resolvedNamespace.toLowerCase().includes(filter) || element.outputPath.toLowerCase().includes(filter);
}

/**
 * `file:line` as a link opening the declaration (`#L<line>` selects the line). Besides being handy, a link is what keeps
 * a tree hover open when the mouse moves into it: VS Code hides link-less workbench hovers on mouse-out.
 */
function declarationLink(element: ResolvedKoreElement): string {
	return `[\`${declarationPathOf(element)}\`](${element.uri.with({ fragment: `L${element.range.start.line + 1}` })})`;
}

/** A horizontal rule needs blank lines around it, else Markdown turns the line above into a heading. */
export const RULE = '\n\n---\n\n';

/**
 * Same tooltip for the tree item and the gutter hover. The resource location is the title since it already carries the
 * namespace and name, the datapack and output path share one row, the command sits alone under a rule so it reads as
 * copy-ready.
 */
export function elementTooltip(element: ResolvedKoreElement): vscode.MarkdownString {
	const kind = kindById(element.kindId);
	const output = element.kindId === 'DATA_PACK' ? `\`${element.outputPath}\`` : `\`${element.resolvedDataPackName}\` › \`${element.outputPath}\``;
	const lines = [
		`**${kind ? displayNameFor(kind) : element.kindId}** \`${element.resourceLocation ?? element.name}\``,
		`$(package) ${output}`,
		`$(file) ${declarationLink(element)}`,
	];
	if (element.isDynamic) {
		lines.push('$(warning) _At least one part is computed at runtime, shown as its source snippet._');
	}
	const sections = [lines.join('  \n')];
	if (element.command) {
		sections.push(`$(terminal) \`${element.command}\``);
	}
	const tooltip = new vscode.MarkdownString(sections.join(RULE));
	tooltip.supportThemeIcons = true;
	return tooltip;
}

/** Distinct values as code, cut short so one crowded namespace cannot stretch the hover off-screen. */
function listed(values: (string | undefined)[]): string {
	const distinct = [...new Set(values.filter(value => value !== undefined))].sort(COLLATOR.compare);
	const shown = distinct.slice(0, MAX_LISTED).map(value => `\`${value}\``).join(', ');
	return distinct.length > MAX_LISTED ? `${shown}, +${distinct.length - MAX_LISTED} more` : shown;
}

/** The hover of a container row: what it writes, how many elements it holds and what they are made of. */
function containerTooltip(options: KoreTreeItemOptions, values: CopyableValues): vscode.MarkdownString {
	const { elements, label } = options;
	const kind = kindById(options.kindId);
	const count = `Elements: ${elements.length}`;
	const kinds = `Kinds: ${listed(elements.map(e => displayNameFor(kindById(e.kindId)!)))}`;
	const files = `Files: ${listed(elements.map(e => path.basename(e.uri.fsPath)))}`;
	const output = values.outputPath ? [`Output Path: \`${values.outputPath}/\``] : [];
	let lines: string[];

	switch (options.type) {
		case 'datapack':
			lines = [
				`**Data Pack** \`${label}\``,
				...(options.element ? [`File: ${declarationLink(options.element)}`] : []),
				...(values.namespace ? [`Output Path: \`${label}/\``] : []),
				count,
				`Namespaces: ${listed(elements.map(e => e.resolvedNamespace))}`,
				kinds,
				files,
			];
			break;
		case 'namespace':
			lines = [`**Namespace** \`${label}\``, `Data Pack: \`${options.dataPackName}\``, ...output, count, `Folders: ${listed(elements.map(e => kindById(e.kindId)!.resourceFolder))}`];
			break;
		case 'folder':
			lines = [`**Resource Folder** \`${label}\``, `Namespace: \`${options.namespace}\``, ...output, count, kinds];
			break;
		case 'category':
			lines = [`**${label}** declarations of \`${options.dataPackName}\``, ...output, count, files];
			break;
		case 'group':
			lines = [`**${kind ? displayNameFor(kind) : 'Folder'}** \`${options.groupData!.pathPrefix}\``, ...output, count, ...(kind ? [] : [kinds]), files];
			break;
		default:
			lines = [`**File** \`${label}\``, `Path: \`${options.filePath}\``, count, `Data Packs: ${listed(elements.map(e => e.resolvedDataPackName))}`, kinds];
	}
	return new vscode.MarkdownString(lines.join('  \n'));
}

function labelOf(item: KoreTreeItem): string {
	return item.label!.toString();
}

export class KoreTreeDataProvider implements vscode.TreeDataProvider<KoreTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;
	/** The filtered element list, computed once per refresh since every row asks for a slice of it. */
	private visible: ResolvedKoreElement[] | undefined;

	constructor(private readonly extensionUri: vscode.Uri, private options: KoreViewOptions = DEFAULT_VIEW_OPTIONS) {
		koreElementManager.onDidChangeElements(() => this.refresh());
	}

	get totalCount(): number {
		return koreElementManager.getElements().length;
	}

	get viewOptions(): Readonly<KoreViewOptions> {
		return this.options;
	}

	get visibleCount(): number {
		return this.visibleElements().length;
	}

	/** The row showing `element` under the current grouping, found by walking down the rows that contain it. */
	findItem(element: ResolvedKoreElement): KoreTreeItem | undefined {
		let items = this.childrenOf(undefined);
		for (;;) {
			const next = items.find(item => item.element === element || item.elements.includes(element));
			if (!next || next.element === element) {
				return next;
			}
			items = this.childrenOf(next);
		}
	}

	getChildren(element?: KoreTreeItem): Thenable<KoreTreeItem[]> {
		return Promise.resolve(this.childrenOf(element));
	}

	getParent(element: KoreTreeItem): KoreTreeItem | undefined {
		return element.parent;
	}

	getTreeItem(element: KoreTreeItem): vscode.TreeItem {
		return element;
	}

	refresh(): void {
		this.visible = undefined;
		this._onDidChangeTreeData.fire();
	}

	setOptions(changes: Partial<KoreViewOptions>): void {
		this.options = { ...this.options, ...changes };
		this.refresh();
	}

	private categoryItems(parent: KoreTreeItem): KoreTreeItem[] {
		const items = [...Map.groupBy(parent.elements, element => element.kindId)].map(([kindId, elements]) => new KoreTreeItem({
			label: displayNameFor(kindById(kindId)!),
			type: 'category',
			kindId,
			id: `${parent.id}/kind:${kindId}`,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName: parent.dataPackName,
			elements,
			folder: kindById(kindId)!.resourceFolder,
			namespace: parent.dataPackName,
			parent,
		}));
		return items.sort((a, b) => COLLATOR.compare(kindSortKey(a.kindId), kindSortKey(b.kindId)));
	}

	private childrenOf(parent?: KoreTreeItem): KoreTreeItem[] {
		switch (parent?.type) {
			case undefined:
				return this.rootItems();
			case 'datapack':
				return this.options.groupBy === 'output' ? this.namespaceItems(parent) : this.categoryItems(parent);
			case 'namespace':
				return this.folderItems(parent);
			case 'category':
			case 'folder':
				return this.pathItems(parent, '');
			case 'group':
				return this.pathItems(parent, `${parent.groupData!.pathPrefix}/`);
			case 'file':
				return this.leaves(parent.elements, parent);
			default:
				return [];
		}
	}

	/**
	 * One root per resolved datapack, named after every element so a datapack declaring no resource still gets its row.
	 * Its `dataPack("x") { }` declaration, looked up in the unfiltered store, gives the row its source and tooltip.
	 */
	private dataPackItems(elements: ResolvedKoreElement[]): KoreTreeItem[] {
		const items = [...Map.groupBy(elements, element => element.resolvedDataPackName)].map(([dataPackName, own]) => new KoreTreeItem({
			label: dataPackName,
			type: 'datapack',
			kindId: 'DATA_PACK',
			id: `datapack:${dataPackName}`,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName,
			extensionUri: this.extensionUri,
			element: koreElementManager.getElementsByKindId('DATA_PACK').find(e => e.name === dataPackName),
			elements: own.filter(e => e.kindId !== 'DATA_PACK'),
		}));

		return items.sort((a, b) => {
			if (a.label === UNKNOWN_DATA_PACK) {
				return 1;
			}
			if (b.label === UNKNOWN_DATA_PACK) {
				return -1;
			}
			return COLLATOR.compare(labelOf(a), labelOf(b));
		});
	}

	private fileItems(elements: ResolvedKoreElement[]): KoreTreeItem[] {
		const items = [...Map.groupBy(elements, element => element.uri.fsPath)].map(([filePath, inFile]) => new KoreTreeItem({
			label: path.basename(filePath),
			type: 'file',
			kindId: '',
			id: `file:${filePath}`,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			elements: inFile,
			filePath,
		}));
		return items.sort((a, b) => COLLATOR.compare(labelOf(a), labelOf(b)));
	}

	/** Sorts leaves and, in declaration order, inserts separators between groups of different files. */
	private finalizeItems(items: KoreTreeItem[], parent?: KoreTreeItem): KoreTreeItem[] {
		const sortedItems = this.sortItems(items);
		if (this.options.sortBy !== 'declaration') {
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
						id: `${parent?.id ?? 'root'}/separator:${result.length}`,
						collapsibleState: vscode.TreeItemCollapsibleState.None,
						elements: [],
						parent,
					}));
				}
				currentFileName = fileName;
			}
			result.push(item);
		}
		return result;
	}

	/** One row per `kind.resourceFolder`, so the 20 recipe kinds collapse into `recipe` like on disk. */
	private folderItems(parent: KoreTreeItem): KoreTreeItem[] {
		const byFolder = Map.groupBy(parent.elements, element => kindById(element.kindId)!.resourceFolder ?? '');
		return [...byFolder].sort(([a], [b]) => COLLATOR.compare(a, b)).map(([folder, elements]) => new KoreTreeItem({
			label: folder,
			type: 'folder',
			kindId: '',
			id: `${parent.id}/folder:${folder}`,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName: parent.dataPackName,
			elements,
			folder,
			namespace: parent.namespace,
			parent,
		}));
	}

	private leafItem(element: ResolvedKoreElement, parent: KoreTreeItem | undefined, shortLabel: boolean): KoreTreeItem {
		return new KoreTreeItem({
			label: shortLabel ? element.name.slice(element.name.lastIndexOf('/') + 1) : resourcePathOf(element),
			type: 'element',
			kindId: element.kindId,
			id: `element:${element.uri.fsPath}:${element.range.start.line}:${element.range.start.character}`,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			command: { command: 'kore-assistant.revealKoreElement', title: 'Reveal Element', arguments: [element] },
			extensionUri: this.extensionUri,
			element,
			elements: [element],
			parent,
		});
	}

	private leaves(elements: ResolvedKoreElement[], parent?: KoreTreeItem): KoreTreeItem[] {
		return this.finalizeItems(elements.map(element => this.leafItem(element, parent, false)), parent);
	}

	private namespaceItems(parent: KoreTreeItem): KoreTreeItem[] {
		const byNamespace = Map.groupBy(parent.elements, element => element.resolvedNamespace);
		return [...byNamespace].sort(([a], [b]) => COLLATOR.compare(a, b)).map(([namespace, elements]) => new KoreTreeItem({
			label: namespace,
			type: 'namespace',
			kindId: '',
			id: `${parent.id}/namespace:${namespace}`,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			dataPackName: parent.dataPackName,
			elements,
			namespace,
			parent,
		}));
	}

	/** Splits the parent's elements on the path segment following `prefix`: a group row per segment, a leaf per direct element. */
	private pathItems(parent: KoreTreeItem, prefix: string): KoreTreeItem[] {
		const groups = Map.groupBy(parent.elements, element => {
			const resourcePath = resourcePathOf(element);
			const nextSlash = resourcePath.indexOf('/', prefix.length);
			return nextSlash === -1 ? '' : resourcePath.slice(prefix.length, nextSlash);
		});

		const items = (groups.get('') ?? []).map(element => this.leafItem(element, parent, true));
		for (const [segment, elements] of groups) {
			if (segment !== '') {
				items.push(new KoreTreeItem({
					label: segment,
					type: 'group',
					kindId: parent.kindId,
					id: `${parent.id}/group:${segment}`,
					collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
					dataPackName: parent.dataPackName,
					elements,
					folder: parent.folder,
					groupData: { pathPrefix: prefix + segment },
					namespace: parent.namespace,
					parent,
				}));
			}
		}
		return this.finalizeItems(items, parent);
	}

	private rootItems(): KoreTreeItem[] {
		const elements = this.visibleElements();
		switch (this.options.groupBy) {
			case 'file':
				return this.fileItems(elements);
			case 'flat':
				return this.leaves(elements);
			default:
				return this.dataPackItems(elements);
		}
	}

	/** Path groups first, alphabetically, then the leaves by the active criterion and direction. */
	private sortItems(items: KoreTreeItem[]): KoreTreeItem[] {
		const compare = COMPARATORS[this.options.sortBy];
		const direction = this.options.sortOrder === 'asc' ? 1 : -1;
		return items.sort((a, b) => {
			if (!a.element || !b.element) {
				if (a.element || b.element) {
					return a.element ? 1 : -1;
				}
				return COLLATOR.compare(labelOf(a), labelOf(b));
			}
			return direction * compare(a.element, b.element);
		});
	}

	private visibleElements(): ResolvedKoreElement[] {
		if (!this.visible) {
			const filter = this.options.filter.toLowerCase();
			const elements = koreElementManager.getElements();
			this.visible = filter ? elements.filter(element => matches(element, filter)) : elements;
		}
		return this.visible;
	}
}

/** The bulk entries of a container row: one line per element underneath. */
function bulkValues(elements: ResolvedKoreElement[]): CopyableValues {
	const locations = elements.map(e => e.resourceLocation).filter(location => location !== undefined);
	return {
		outputPaths: elements.map(e => e.outputPath).join('\n') || undefined,
		resourceLocations: locations.join('\n') || undefined,
	};
}

/**
 * What each node can copy. A datapack root only knows its output folder when it resolved to a real name, and its source
 * only when its `dataPack("x") { }` declaration was found; namespaces, folders, categories and groups copy the folder
 * they map to, and every container copies the locations and paths of its whole subtree.
 */
function copyableValues(options: KoreTreeItemOptions): CopyableValues {
	const { type, element, groupData, elements } = options;
	// Rows under a namespace row carry it; datapack and kind-view rows stand for the datapack's own namespace.
	const owner = options.namespace ?? options.dataPackName;
	const namespace = owner !== UNKNOWN_DATA_PACK ? owner : undefined;
	const bulk = type === 'element' ? {} : bulkValues(elements);

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
				...bulk,
				declarationPath: element && declarationPathOf(element),
				filePath: element?.uri.fsPath,
				name: namespace,
				namespace,
				outputPath: namespace && outputPathFor({ kind: DATA_PACK_KIND, name: namespace, namespace }),
			};
		case 'namespace':
			return { ...bulk, name: namespace, namespace, outputPath: namespace && `data/${namespace}` };
		case 'folder':
			return { ...bulk, name: options.label, namespace, outputPath: namespace && `data/${namespace}/${options.folder}` };
		case 'category':
			return { ...bulk, name: options.label, namespace, outputPath: namespace && `data/${namespace}/${options.folder}` };
		case 'group':
			return { ...bulk, name: groupData!.pathPrefix, namespace, outputPath: namespace && `data/${namespace}/${options.folder}/${groupData!.pathPrefix}` };
		case 'file':
			return {
				...bulk,
				declarationPath: vscode.workspace.asRelativePath(options.filePath!, false),
				filePath: options.filePath,
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
	public readonly elements: ResolvedKoreElement[];
	public readonly filePath?: string;
	public readonly folder?: string;
	public readonly groupData?: KoreTreeItemOptions['groupData'];
	public readonly id: string;
	public readonly kindId: string;
	public readonly namespace?: string;
	public readonly parent?: KoreTreeItem;
	public readonly type: KoreTreeItemType;
	public readonly values: CopyableValues;

	constructor(options: KoreTreeItemOptions) {
		super(options.label, options.collapsibleState);

		this.command = options.command;
		this.dataPackName = options.dataPackName;
		this.element = options.element;
		this.elements = options.elements;
		this.filePath = options.filePath;
		this.folder = options.folder;
		this.groupData = options.groupData;
		this.id = options.id;
		this.kindId = options.kindId;
		this.namespace = options.namespace;
		this.parent = options.parent;
		this.type = options.type;
		this.values = Object.fromEntries(Object.entries(copyableValues(options)).filter(([, value]) => value).sort(([a], [b]) => a.localeCompare(b)));
		this.contextValue = [options.type, ...Object.keys(this.values)].join(' ');

		const { extensionUri, element, elements } = options;
		const kind = kindById(options.kindId);
		const assetIcon = (name: string) => ({
			light: vscode.Uri.joinPath(extensionUri!, 'dist', 'assets', `${name}-light.svg`),
			dark: vscode.Uri.joinPath(extensionUri!, 'dist', 'assets', `${name}-dark.svg`),
		});

		switch (options.type) {
			case 'element':
				if (extensionUri && kind) {
					this.iconPath = assetIcon(elementIconName(kind));
				}
				// `~` marks a name built at runtime, the closest a tree row gets to the italics IntelliJ uses.
				this.description = `${element!.isDynamic ? '~ ' : ''}${path.basename(element!.uri.fsPath)} (${element!.range.start.line + 1})`;
				this.tooltip = elementTooltip(element!);
				return;
			case 'separator':
				this.tooltip = '';
				this.iconPath = new vscode.ThemeIcon('dash');
				return;
			case 'datapack':
				if (extensionUri) {
					this.iconPath = assetIcon('datapack');
				}
				this.description = `${elements.length} element${elements.length === 1 ? '' : 's'}`;
				break;
			case 'namespace':
				this.iconPath = new vscode.ThemeIcon('package');
				break;
			case 'category':
				this.iconPath = new vscode.ThemeIcon(categoryThemeIcon(kind));
				break;
			case 'folder':
			case 'group':
				this.iconPath = new vscode.ThemeIcon('folder');
				break;
			case 'file':
				this.iconPath = new vscode.ThemeIcon('file-code');
				break;
		}
		this.description ??= String(elements.length);
		this.tooltip = containerTooltip(options, this.values);
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
