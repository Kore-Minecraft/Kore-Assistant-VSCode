import * as vscode from 'vscode';
import { koreElementManager, ResolvedKoreElement } from './koreElements';
import { DEFAULT_VIEW_OPTIONS, KoreGroupBy, KoreSortBy, KoreTreeDataProvider, KoreTreeItem, KoreViewOptions } from './koreTreeView';

const GROUPINGS: [KoreGroupBy, string, string][] = [
	['output', 'Output Structure', 'datapack > namespace > resource folder, the generated layout'],
	['kind', 'Kind', 'datapack > declaration kind > path'],
	['file', 'Source File', 'one node per Kotlin file'],
	['flat', 'Flat List', 'every declaration at the root'],
];

const SORTINGS: [KoreSortBy, string][] = [
	['name', 'Name'],
	['kind', 'Kind'],
	['namespace', 'Namespace'],
	['declaration', 'Declaration Order'],
];

/** Grouping, sorting and direction survive a reload; the filter is deliberately not persisted. */
const STATE_KEY = 'kore-assistant.explorer';

/** The Kore Explorer view: the tree, its toolbar commands, the filter state and the reveal-from-editor command. */
export class KoreExplorer implements vscode.Disposable {
	readonly provider: KoreTreeDataProvider;
	private readonly disposables: vscode.Disposable[];
	private readonly state: vscode.Memento;
	private readonly treeView: vscode.TreeView<KoreTreeItem>;

	constructor(context: vscode.ExtensionContext, private readonly rescan: () => Promise<void>) {
		this.state = context.workspaceState;
		this.provider = new KoreTreeDataProvider(context.extensionUri, { ...DEFAULT_VIEW_OPTIONS, ...this.state.get<Partial<KoreViewOptions>>(STATE_KEY), filter: '' });
		this.treeView = vscode.window.createTreeView('koreExplorer', { treeDataProvider: this.provider, showCollapseAll: true });
		this.disposables = [
			this.treeView,
			this.provider.onDidChangeTreeData(() => this.updateViewState()),
			vscode.commands.registerCommand('kore-assistant.selectGrouping', () => this.selectGrouping()),
			vscode.commands.registerCommand('kore-assistant.selectSorting', () => this.selectSorting()),
			vscode.commands.registerCommand('kore-assistant.filter', () => this.editFilter()),
			vscode.commands.registerCommand('kore-assistant.clearFilter', () => this.provider.setOptions({ filter: '' })),
			vscode.commands.registerCommand('kore-assistant.refreshExplorer', () => this.rescan()),
			vscode.commands.registerCommand('kore-assistant.revealInExplorer', () => this.revealActiveElement()),
		];
		this.updateViewState();
	}

	dispose(): void {
		vscode.Disposable.from(...this.disposables).dispose();
	}

	private async editFilter(): Promise<void> {
		const value = await vscode.window.showInputBox({
			prompt: 'Filter Kore elements by name, namespace or output path',
			placeHolder: 'e.g. loot_table, minecraft, blocks/leaves',
			value: this.provider.viewOptions.filter,
		});
		if (value !== undefined) {
			this.provider.setOptions({ filter: value.trim() });
		}
	}

	/** The declaration on the cursor's line, else the innermost one whose body holds the cursor (a `dataPack { }` block). */
	private async revealActiveElement(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const cursor = editor.selection.active;
		const elements = koreElementManager.getElementsForUri(editor.document.uri);
		let element: ResolvedKoreElement | undefined = elements.find(e => e.range.start.line === cursor.line);
		if (!element) {
			for (const candidate of elements) {
				if (candidate.bodyRange?.contains(cursor) && (!element || candidate.bodyRange.start.isAfter(element.bodyRange!.start))) {
					element = candidate;
				}
			}
		}
		if (!element) {
			vscode.window.showInformationMessage('No Kore declaration at the cursor.');
			return;
		}

		const item = this.provider.findItem(element);
		if (!item) {
			vscode.window.showInformationMessage(`'${element.name}' is hidden by the explorer filter.`);
			return;
		}
		await this.treeView.reveal(item, { select: true, focus: true, expand: true });
	}

	private async selectGrouping(): Promise<void> {
		const current = this.provider.viewOptions.groupBy;
		const picked = await vscode.window.showQuickPick(
			GROUPINGS.map(([groupBy, label, description]) => ({ label: `${groupBy === current ? '$(check)' : '$(blank)'} ${label}`, description, groupBy })),
			{ placeHolder: 'Group Kore elements by' },
		);
		if (picked) {
			this.setOptions({ groupBy: picked.groupBy });
		}
	}

	/** Re-picking the active criterion flips the direction, the usual IDE list behaviour. */
	private async selectSorting(): Promise<void> {
		const { sortBy: current, sortOrder } = this.provider.viewOptions;
		const currentIcon = sortOrder === 'asc' ? '$(arrow-up)' : '$(arrow-down)';
		const picked = await vscode.window.showQuickPick(
			SORTINGS.map(([sortBy, label]) => ({
				label: `${sortBy === current ? currentIcon : '$(blank)'} ${label}`,
				description: sortBy === current ? 'pick again to flip the direction' : undefined,
				sortBy,
			})),
			{ placeHolder: 'Sort Kore elements by' },
		);
		if (picked) {
			const flipped = sortOrder === 'asc' ? 'desc' : 'asc';
			this.setOptions({ sortBy: picked.sortBy, sortOrder: picked.sortBy === current ? flipped : 'asc' });
		}
	}

	private setOptions(changes: Partial<KoreViewOptions>): void {
		this.provider.setOptions(changes);
		const { groupBy, sortBy, sortOrder } = this.provider.viewOptions;
		this.state.update(STATE_KEY, { groupBy, sortBy, sortOrder });
	}

	/** The message line above the tree doubles as the empty state, since `viewsWelcome` only shows for a fully empty view. */
	private updateViewState(): void {
		const { filter } = this.provider.viewOptions;
		const total = this.provider.totalCount;
		const visible = this.provider.visibleCount;

		vscode.commands.executeCommand('setContext', 'koreFilterActive', filter !== '');
		this.treeView.badge = filter ? { value: visible, tooltip: `${visible} of ${total} Kore elements match '${filter}'` } : undefined;
		if (total === 0) {
			this.treeView.message = 'No Kore elements found.';
		} else if (filter) {
			this.treeView.message = visible === 0 ? `No element matches '${filter}'.` : `Filter: ${filter} (${visible} of ${total})`;
		} else {
			this.treeView.message = undefined;
		}
	}
}
