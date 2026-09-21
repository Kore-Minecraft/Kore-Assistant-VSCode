import * as assert from 'assert';
import * as vscode from 'vscode';
import { KoreElement, koreElementManager, UNKNOWN_DATA_PACK } from '../koreElements';
import { KoreTreeDataProvider, KoreTreeItem } from '../koreTreeView';

const extensionUri = vscode.Uri.file('/ext');
const fileA = vscode.Uri.file('/ws/A.kt');
const fileB = vscode.Uri.file('/ws/B.kt');
// No workspace is open in the test host, so the "relative" path is the input echoed back in platform form.
const pathA = vscode.workspace.asRelativePath(fileA, false);

function element(uri: vscode.Uri, kindId: string, name: string, line = 0, extra: Partial<KoreElement> = {}): KoreElement {
	return { kindId, name, isDynamic: false, dynamicFields: [], offset: 0, nameArgRange: new vscode.Range(line, 0, line, 0), range: new vscode.Range(line, 0, line, 1), uri, ...extra };
}

function labels(items: KoreTreeItem[]): string[] {
	return items.map(i => i.label!.toString());
}

function seed(...entries: (readonly [vscode.Uri, KoreElement[]])[]): void {
	koreElementManager.replaceElementsForUris(entries);
}

suite('KoreTreeDataProvider', () => {
	let provider: KoreTreeDataProvider;

	setup(() => {
		provider = new KoreTreeDataProvider(extensionUri);
	});

	teardown(() => {
		koreElementManager.removeElementsForUris([fileA, fileB]);
	});

	test('is empty with no elements', async () => {
		assert.deepStrictEqual(await provider.getChildren(), []);
	});

	test('refreshes when the element store changes', () => {
		let fired = 0;
		provider.onDidChangeTreeData(() => fired++);
		seed([fileA, [element(fileA, 'FUNCTION', 'f')]]);
		assert.strictEqual(fired, 1);
	});

	suite('grouped by datapack', () => {
		test('one root per resolved datapack, sorted by name with the unknown one last', async () => {
			seed(
				[fileA, [element(fileA, 'DATA_PACK', 'zeta'), element(fileA, 'DATA_PACK', 'alpha')]],
				[fileB, [element(fileB, 'FUNCTION', 'orphan'), element(fileB, 'FUNCTION', 'owned', 1, { dataPackName: 'zeta' })]],
			);

			const roots = await provider.getChildren();
			assert.deepStrictEqual(labels(roots), ['alpha', 'zeta', UNKNOWN_DATA_PACK]);
			assert.ok(roots.every(r => r.type === 'datapack'));
			assert.strictEqual(roots[0].element?.name, 'alpha');
			assert.strictEqual(roots[2].element, undefined);
		});

		test('a datapack root lists one category per kind, DATA_PACK itself excluded, alphabetically', async () => {
			seed([fileA, [
				element(fileA, 'DATA_PACK', 'p'),
				element(fileA, 'LOOT_TABLE', 'l', 1, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'f', 2, { dataPackName: 'p' }),
				element(fileA, 'ADVANCEMENT', 'a', 3, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'other', 4, { dataPackName: 'q' }),
			]]);

			const [root] = await provider.getChildren();
			const categories = await provider.getChildren(root);
			assert.deepStrictEqual(labels(categories), ['Advancement', 'Function', 'Loot Table']);
			assert.ok(categories.every(c => c.type === 'category' && c.dataPackName === 'p'));
		});

		test('a category only lists elements of its own datapack', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'mine', 0, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'theirs', 1, { dataPackName: 'q' }),
			]]);

			const roots = await provider.getChildren();
			const [category] = await provider.getChildren(roots.find(r => r.dataPackName === 'p'));
			const items = await provider.getChildren(category);
			assert.deepStrictEqual(labels(items), ['mine']);
		});

		test('splits slash-separated names into nested groups and shows only the last segment', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'top', 0, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'dir/leaf', 1, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'dir/deep/leaf2', 2, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'zdir/x', 3, { dataPackName: 'p' }),
			]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const items = await provider.getChildren(category);
			assert.deepStrictEqual(labels(items), ['dir', 'zdir', 'top']);
			assert.deepStrictEqual(items.map(i => i.type), ['group', 'group', 'element']);

			const dir = await provider.getChildren(items[0]);
			assert.deepStrictEqual(labels(dir), ['deep', 'leaf']);
			assert.strictEqual(dir[0].groupData?.pathPrefix, 'dir/deep');

			const deep = await provider.getChildren(dir[0]);
			assert.deepStrictEqual(labels(deep), ['leaf2']);
			assert.strictEqual(deep[0].element?.name, 'dir/deep/leaf2');
		});

		test('a group named like a prefix of another does not swallow its elements', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'ab/x', 0, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'abc/y', 1, { dataPackName: 'p' }),
			]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const [ab] = await provider.getChildren(category);
			assert.strictEqual(ab.label, 'ab');
			assert.deepStrictEqual(labels(await provider.getChildren(ab)), ['x']);
		});

		test('sorting by file orders by file then name and inserts separators between files', async () => {
			seed(
				[fileB, [element(fileB, 'FUNCTION', 'b_first', 0, { dataPackName: 'p' })]],
				[fileA, [element(fileA, 'FUNCTION', 'z', 0, { dataPackName: 'p' }), element(fileA, 'FUNCTION', 'a', 5, { dataPackName: 'p' })]],
			);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const items = await provider.getChildren(category);
			assert.deepStrictEqual(items.map(i => i.type), ['element', 'element', 'separator', 'element']);
			assert.deepStrictEqual(labels(items.filter(i => i.type === 'element')), ['a', 'z', 'b_first']);
			assert.strictEqual(items[0].description, 'A.kt (6)');
		});

		test('sorting by name ignores files and emits no separators', async () => {
			provider.setSortByFile(false);
			seed(
				[fileB, [element(fileB, 'FUNCTION', 'b_first', 0, { dataPackName: 'p' })]],
				[fileA, [element(fileA, 'FUNCTION', 'z', 0, { dataPackName: 'p' }), element(fileA, 'FUNCTION', 'a', 5, { dataPackName: 'p' })]],
			);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const items = await provider.getChildren(category);
			assert.deepStrictEqual(labels(items), ['a', 'b_first', 'z']);
			assert.ok(items.every(i => i.type === 'element'));
		});
	});

	suite('grouped by file', () => {
		setup(() => provider.setGroupByFile(true));

		test('one root per file, sorted by file name, with a count tooltip', async () => {
			seed(
				[fileB, [element(fileB, 'FUNCTION', 'b')]],
				[fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'FUNCTION', 'f', 1), element(fileA, 'LOOT_TABLE', 'l', 2)]],
			);

			const roots = await provider.getChildren();
			assert.deepStrictEqual(labels(roots), ['A.kt', 'B.kt']);
			assert.ok(roots.every(r => r.type === 'file'));
			assert.strictEqual(roots[0].tooltip, 'File: A.kt\nDatapacks: 1\nFunctions: 1\nOther: 1\nTotal elements: 3');
		});

		test('a file lists its elements flat, datapack first then by kind then by name', async () => {
			seed([fileA, [
				element(fileA, 'LOOT_TABLE', 'l', 0),
				element(fileA, 'FUNCTION', 'z', 1),
				element(fileA, 'FUNCTION', 'a', 2),
				element(fileA, 'DATA_PACK', 'p', 3),
			]]);

			const [file] = await provider.getChildren();
			const items = await provider.getChildren(file);
			assert.deepStrictEqual(labels(items), ['p', 'a', 'z', 'l']);
			assert.ok(items.every(i => i.type === 'element'));
		});
	});

	suite('element items', () => {
		test('carry the reveal command, description with line and a full tooltip', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'dir/main', 4, { dataPackName: 'p', directory: 'sub' })]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const [group] = await provider.getChildren(category);
			const [item] = await provider.getChildren(group);

			assert.strictEqual(item.label, 'main');
			assert.strictEqual(item.description, 'A.kt (5)');
			assert.strictEqual(item.command?.command, 'kore-assistant.revealKoreElement');
			assert.strictEqual(item.command?.arguments?.[0], item.element);
			assert.strictEqual((item.tooltip as vscode.MarkdownString).value, [
				'**Function** `dir/main`',
				'Namespace: `p`',
				'Data Pack: `p`',
				`File: \`${pathA}:5\``,
				'Resource Location: `p:sub/dir/main`',
				'Output Path: `data/p/function/sub/dir/main.mcfunction`',
				'Command: `/function p:sub/dir/main`',
			].join('  \n'));
		});

		test('a dynamic element gets the runtime note, a datapack element no namespace lines', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p', 0, { isDynamic: true, dynamicFields: ['name'] })]]);
			provider.setGroupByFile(true);

			const [file] = await provider.getChildren();
			const [item] = await provider.getChildren(file);
			assert.strictEqual((item.tooltip as vscode.MarkdownString).value, [
				'**Data Pack** `p`',
				`File: \`${pathA}:1\``,
				'Output Path: `p/pack.mcmeta`',
				'_At least one part is computed at runtime, shown as its source snippet._',
			].join('  \n'));
		});

		test('expose every copyable value and flag them in the contextValue for the menu when-clauses', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'main', 2, { dataPackName: 'p' }), element(fileA, 'BIOME', 'b', 3, { dataPackName: 'p' })]]);
			provider.setGroupByFile(true);

			const [file] = await provider.getChildren();
			const [fn, biome] = await provider.getChildren(file);

			assert.deepStrictEqual(fn.values, {
				name: 'main',
				namespace: 'p',
				resourceLocation: 'p:main',
				outputPath: 'data/p/function/main.mcfunction',
				command: '/function p:main',
				filePath: fileA.fsPath,
				declarationPath: `${pathA}:3`,
			});
			assert.strictEqual(fn.contextValue, 'element command declarationPath filePath name namespace outputPath resourceLocation');
			assert.strictEqual(biome.values.command, undefined);
			assert.strictEqual(biome.contextValue, 'element declarationPath filePath name namespace outputPath resourceLocation');
		});
	});

	suite('container items', () => {
		test('a declared datapack root copies its own source and pack.mcmeta, an unknown one copies nothing', async () => {
			// Two datapacks, so the sole-datapack fallback doesn't adopt the orphan.
			seed([fileA, [element(fileA, 'DATA_PACK', 'p', 1), element(fileA, 'DATA_PACK', 'q', 2)]], [fileB, [element(fileB, 'FUNCTION', 'orphan')]]);

			const [declared, , unknown] = await provider.getChildren();
			assert.deepStrictEqual(declared.values, {
				name: 'p',
				namespace: 'p',
				outputPath: 'p/pack.mcmeta',
				filePath: fileA.fsPath,
				declarationPath: `${pathA}:2`,
			});
			assert.strictEqual(declared.contextValue, 'datapack declarationPath filePath name namespace outputPath');
			assert.strictEqual((declared.tooltip as vscode.MarkdownString).value.split('  \n')[0], '**Data Pack** `p`');
			assert.deepStrictEqual(unknown.values, {});
			assert.strictEqual(unknown.contextValue, 'datapack');
		});

		test('categories and groups copy the output folder they map to', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'dir/main', 0, { dataPackName: 'p' })]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const [group] = await provider.getChildren(category);
			assert.deepStrictEqual(category.values, { name: 'Function', namespace: 'p', outputPath: 'data/p/function' });
			assert.deepStrictEqual(group.values, { name: 'dir', namespace: 'p', outputPath: 'data/p/function/dir' });
		});

		test('a file root copies its absolute and workspace-relative path', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'f')]]);
			provider.setGroupByFile(true);

			const [file] = await provider.getChildren();
			assert.deepStrictEqual(file.values, { name: 'A.kt', filePath: fileA.fsPath, declarationPath: pathA });
			assert.strictEqual(file.contextValue, 'file declarationPath filePath name');
		});

		test('icons come from the extension assets per kind family', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'TICK', 't', 1), element(fileA, 'BIOME', 'b', 2)]]);
			provider.setGroupByFile(true);

			const [file] = await provider.getChildren();
			const items = await provider.getChildren(file);
			const iconNames = items.map(i => (i.iconPath as { dark: vscode.Uri }).dark.path.split('/').pop());
			assert.deepStrictEqual(iconNames, ['datapack-dark.svg', 'function-dark.svg', 'json-dark.svg']);
		});
	});
});
