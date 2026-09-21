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

function tooltipOf(item: KoreTreeItem): string {
	return (item.tooltip as vscode.MarkdownString).value;
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
		assert.strictEqual(provider.totalCount, 0);
	});

	test('refreshes when the element store changes or an option changes', () => {
		let fired = 0;
		provider.onDidChangeTreeData(() => fired++);
		seed([fileA, [element(fileA, 'FUNCTION', 'f')]]);
		provider.setOptions({ groupBy: 'flat' });
		assert.strictEqual(fired, 2);
		assert.strictEqual(provider.viewOptions.groupBy, 'flat');
	});

	suite('grouped by kind', () => {
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
			assert.deepStrictEqual(roots.map(r => r.description), ['0 elements', '1 element', '1 element']);
		});

		test('a datapack root lists one category per kind, DATA_PACK itself excluded, by resource folder', async () => {
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
			assert.ok(categories.every(c => c.type === 'category' && c.dataPackName === 'p' && c.parent === root && c.description === '1'));
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
			assert.strictEqual(items[0].description, '2');

			const dir = await provider.getChildren(items[0]);
			assert.deepStrictEqual(labels(dir), ['deep', 'leaf']);
			assert.strictEqual(dir[0].groupData?.pathPrefix, 'dir/deep');

			const deep = await provider.getChildren(dir[0]);
			assert.deepStrictEqual(labels(deep), ['leaf2']);
			assert.strictEqual(deep[0].element?.name, 'dir/deep/leaf2');
			assert.strictEqual(provider.getParent(deep[0]), dir[0]);
		});

		test('a function directory is a folder, mixing with slash-separated names, and the full path shows outside the kind view', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'on_death', 0, { dataPackName: 'p', directory: 'hearts' }),
				element(fileA, 'FUNCTION', 'hearts/on_kill', 1, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'sync', 2, { dataPackName: 'p', directory: 'player/' }),
			]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const folders = await provider.getChildren(category);
			assert.deepStrictEqual(labels(folders), ['hearts', 'player']);
			assert.deepStrictEqual(labels(await provider.getChildren(folders[0])), ['on_death', 'on_kill']);
			assert.deepStrictEqual(labels(await provider.getChildren(folders[1])), ['sync']);
			assert.deepStrictEqual(folders[0].values.outputPath, 'data/p/function/hearts');

			provider.setOptions({ groupBy: 'flat' });
			assert.deepStrictEqual(labels(await provider.getChildren()), ['hearts/on_death', 'hearts/on_kill', 'player/sync']);
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
	});

	suite('grouped by output structure', () => {
		setup(() => provider.setOptions({ groupBy: 'output' }));

		test('datapack > namespace > resource folder > element, recipes and tags collapsing into their folder', async () => {
			seed([fileA, [
				element(fileA, 'DATA_PACK', 'p'),
				element(fileA, 'CRAFTING_SHAPED', 'r1', 1, { dataPackName: 'p' }),
				element(fileA, 'SMELTING', 'r2', 2, { dataPackName: 'p' }),
				element(fileA, 'BLOCK_TAG', 'logs', 3, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'dir/leaf', 4, { dataPackName: 'p', namespace: 'other' }),
			]]);

			const [root] = await provider.getChildren();
			const namespaces = await provider.getChildren(root);
			assert.deepStrictEqual(labels(namespaces), ['other', 'p']);
			assert.ok(namespaces.every(n => n.type === 'namespace' && n.dataPackName === 'p'));

			const folders = await provider.getChildren(namespaces[1]);
			assert.deepStrictEqual(labels(folders), ['recipe', 'tags/block']);
			assert.deepStrictEqual(folders.map(f => f.description), ['2', '1']);
			assert.deepStrictEqual(labels(await provider.getChildren(folders[0])), ['r1', 'r2']);

			const [fnFolder] = await provider.getChildren(namespaces[0]);
			const [dir] = await provider.getChildren(fnFolder);
			assert.deepStrictEqual([dir.type, dir.label, dir.values.outputPath], ['group', 'dir', 'data/other/function/dir']);
			assert.strictEqual(tooltipOf(dir), '**Folder** `dir`  \nOutput Path: `data/other/function/dir/`  \nElements: 1  \nKinds: `Function`  \nFiles: `A.kt`');
			const [fn] = await provider.getChildren(dir);
			assert.deepStrictEqual([fn.type, fn.label, provider.getParent(fn)], ['element', 'leaf', dir]);
		});

		test('a function directory nests under function/ like on disk', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'on_death', 0, { dataPackName: 'p', directory: 'hearts' }),
				element(fileA, 'ADVANCEMENT', 'kill', 1, { dataPackName: 'p' }),
			]]);

			const [root] = await provider.getChildren();
			const [namespace] = await provider.getChildren(root);
			const [advancement, fn] = await provider.getChildren(namespace);
			assert.deepStrictEqual(labels(await provider.getChildren(advancement)), ['kill']);
			const [hearts] = await provider.getChildren(fn);
			assert.deepStrictEqual([hearts.type, hearts.label], ['group', 'hearts']);
			assert.deepStrictEqual(labels(await provider.getChildren(hearts)), ['on_death']);
		});

		test('namespace and folder rows copy their output folder and everything underneath', async () => {
			seed([fileA, [
				element(fileA, 'FUNCTION', 'a', 0, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'b', 1, { dataPackName: 'p' }),
			]]);

			const [root] = await provider.getChildren();
			const [namespace] = await provider.getChildren(root);
			const [folder] = await provider.getChildren(namespace);
			assert.deepStrictEqual(namespace.values, {
				name: 'p',
				namespace: 'p',
				outputPath: 'data/p',
				outputPaths: 'data/p/function/a.mcfunction\ndata/p/function/b.mcfunction',
				resourceLocations: 'p:a\np:b',
			});
			assert.strictEqual(namespace.contextValue, 'namespace name namespace outputPath outputPaths resourceLocations');
			assert.deepStrictEqual(folder.values, {
				name: 'function',
				namespace: 'p',
				outputPath: 'data/p/function',
				outputPaths: 'data/p/function/a.mcfunction\ndata/p/function/b.mcfunction',
				resourceLocations: 'p:a\np:b',
			});
			assert.strictEqual(tooltipOf(namespace), '**Namespace** `p`  \nData Pack: `p`  \nOutput Path: `data/p/`  \nElements: 2  \nFolders: `function`');
			assert.strictEqual(tooltipOf(folder), '**Resource Folder** `function`  \nNamespace: `p`  \nOutput Path: `data/p/function/`  \nElements: 2  \nKinds: `Function`');
		});

		test('an unknown datapack keeps its rows but copies no folder', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'DATA_PACK', 'q', 1)]], [fileB, [element(fileB, 'FUNCTION', 'orphan')]]);

			const [, , unknown] = await provider.getChildren();
			const [namespace] = await provider.getChildren(unknown);
			assert.strictEqual(namespace.label, UNKNOWN_DATA_PACK);
			assert.deepStrictEqual(Object.keys(namespace.values), ['outputPaths', 'resourceLocations']);
		});
	});

	suite('grouped by file', () => {
		setup(() => provider.setOptions({ groupBy: 'file' }));

		test('one root per file, sorted by file name, with a count and a summary tooltip', async () => {
			seed(
				[fileB, [element(fileB, 'FUNCTION', 'b')]],
				[fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'FUNCTION', 'f', 1, { dataPackName: 'p' }), element(fileA, 'LOOT_TABLE', 'l', 2, { dataPackName: 'p' })]],
			);

			const roots = await provider.getChildren();
			assert.deepStrictEqual(labels(roots), ['A.kt', 'B.kt']);
			assert.ok(roots.every(r => r.type === 'file'));
			assert.strictEqual(roots[0].description, '3');
			assert.strictEqual(tooltipOf(roots[0]), `**File** \`A.kt\`  \nPath: \`${fileA.fsPath}\`  \nElements: 3  \nData Packs: \`p\`  \nKinds: \`Data Pack\`, \`Function\`, \`Loot Table\``);
		});

		test('a file lists its elements flat with their full name', async () => {
			seed([fileA, [
				element(fileA, 'LOOT_TABLE', 'l', 0),
				element(fileA, 'FUNCTION', 'dir/z', 1),
				element(fileA, 'FUNCTION', 'a', 2),
				element(fileA, 'DATA_PACK', 'p', 3),
			]]);

			const [file] = await provider.getChildren();
			const items = await provider.getChildren(file);
			assert.deepStrictEqual(labels(items), ['a', 'dir/z', 'l', 'p']);
			assert.ok(items.every(i => i.type === 'element' && i.parent === file));
		});
	});

	suite('flat list', () => {
		test('every element at the root', async () => {
			provider.setOptions({ groupBy: 'flat' });
			seed([fileA, [element(fileA, 'FUNCTION', 'z'), element(fileA, 'DATA_PACK', 'p', 1)]], [fileB, [element(fileB, 'FUNCTION', 'a')]]);

			const items = await provider.getChildren();
			assert.deepStrictEqual(labels(items), ['a', 'p', 'z']);
			assert.ok(items.every(i => i.type === 'element' && i.parent === undefined));
		});
	});

	suite('sorting', () => {
		const seedMixed = () => seed(
			[fileB, [element(fileB, 'FUNCTION', 'b_first', 0, { dataPackName: 'p' })]],
			[fileA, [
				element(fileA, 'LOOT_TABLE', 'Loot', 0, { dataPackName: 'p', namespace: 'zz' }),
				element(fileA, 'FUNCTION', 'z', 1, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'a', 5, { dataPackName: 'p' }),
			]],
		);

		test('by name is case-insensitive and ignores files', async () => {
			provider.setOptions({ groupBy: 'flat' });
			seedMixed();
			assert.deepStrictEqual(labels(await provider.getChildren()), ['a', 'b_first', 'Loot', 'z']);
		});

		test('descending reverses the leaves but not the containers', async () => {
			provider.setOptions({ groupBy: 'file', sortOrder: 'desc' });
			seedMixed();
			const roots = await provider.getChildren();
			assert.deepStrictEqual(labels(roots), ['A.kt', 'B.kt']);
			assert.deepStrictEqual(labels(await provider.getChildren(roots[0])), ['z', 'Loot', 'a']);
		});

		test('by kind clusters by resource folder then display name', async () => {
			provider.setOptions({ groupBy: 'flat', sortBy: 'kind' });
			seedMixed();
			assert.deepStrictEqual(labels(await provider.getChildren()), ['a', 'b_first', 'z', 'Loot']);
		});

		test('by namespace then name', async () => {
			provider.setOptions({ groupBy: 'flat', sortBy: 'namespace' });
			seedMixed();
			assert.deepStrictEqual(labels(await provider.getChildren()), ['a', 'b_first', 'z', 'Loot']);
		});

		test('by declaration order follows file then position and inserts separators between files', async () => {
			provider.setOptions({ groupBy: 'flat', sortBy: 'declaration' });
			seedMixed();
			const items = await provider.getChildren();
			assert.deepStrictEqual(items.map(i => i.type), ['element', 'element', 'element', 'separator', 'element']);
			assert.deepStrictEqual(labels(items.filter(i => i.type === 'element')), ['Loot', 'z', 'a', 'b_first']);
			assert.strictEqual(items[2].description, 'A.kt (6)');
		});

		test('path groups always come first, alphabetically, whatever the criterion', async () => {
			provider.setOptions({ sortBy: 'declaration', sortOrder: 'desc' });
			seed([fileA, [
				element(fileA, 'FUNCTION', 'top', 0, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'z/leaf', 1, { dataPackName: 'p' }),
				element(fileA, 'FUNCTION', 'a/leaf', 2, { dataPackName: 'p' }),
			]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			assert.deepStrictEqual(labels(await provider.getChildren(category)), ['a', 'z', 'top']);
		});
	});

	suite('filter', () => {
		const seedFiltered = () => seed([fileA, [
			element(fileA, 'DATA_PACK', 'p'),
			element(fileA, 'FUNCTION', 'Main', 1, { dataPackName: 'p' }),
			element(fileA, 'LOOT_TABLE', 'chest', 2, { dataPackName: 'p', namespace: 'other' }),
		]]);

		test('matches the name, namespace or output path, ignoring case', async () => {
			seedFiltered();
			provider.setOptions({ groupBy: 'flat', filter: 'main' });
			assert.deepStrictEqual(labels(await provider.getChildren()), ['Main']);
			provider.setOptions({ filter: 'OTHER' });
			assert.deepStrictEqual(labels(await provider.getChildren()), ['chest']);
			provider.setOptions({ filter: 'loot_table/' });
			assert.deepStrictEqual(labels(await provider.getChildren()), ['chest']);
			assert.strictEqual(provider.visibleCount, 1);
			assert.strictEqual(provider.totalCount, 3);
		});

		test('drops empty containers but keeps the datapack source for the surviving root', async () => {
			seedFiltered();
			provider.setOptions({ filter: 'chest' });
			const roots = await provider.getChildren();
			assert.deepStrictEqual(labels(roots), ['p']);
			assert.strictEqual(roots[0].element?.kindId, 'DATA_PACK');
			assert.deepStrictEqual(labels(await provider.getChildren(roots[0])), ['Loot Table']);
		});

		test('an empty filter shows everything again', async () => {
			seedFiltered();
			provider.setOptions({ filter: 'nothing-matches' });
			assert.deepStrictEqual(await provider.getChildren(), []);
			provider.setOptions({ filter: '' });
			assert.strictEqual(provider.visibleCount, 3);
		});
	});

	suite('element items', () => {
		test('carry the reveal command, description with line and a full tooltip', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'dir/main', 4, { dataPackName: 'p', directory: 'sub' })]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const [sub] = await provider.getChildren(category);
			const [group] = await provider.getChildren(sub);
			const [item] = await provider.getChildren(group);

			assert.deepStrictEqual([sub.label, group.label, item.label], ['sub', 'dir', 'main']);
			assert.strictEqual(item.description, 'A.kt (5)');
			assert.strictEqual(item.id, `element:${fileA.fsPath}:4:0`);
			assert.strictEqual(item.command?.command, 'kore-assistant.revealKoreElement');
			assert.strictEqual(item.command?.arguments?.[0], item.element);
			assert.strictEqual(tooltipOf(item), [
				'**Function** `p:sub/dir/main`',
				'$(package) `p` › `data/p/function/sub/dir/main.mcfunction`',
				`$(file) [\`${pathA}:5\`](${fileA.with({ fragment: 'L5' })})`,
			].join('  \n') + '\n\n---\n\n$(terminal) `/function p:sub/dir/main`');
		});

		test('a dynamic element gets the runtime note and marker, a datapack element no namespace lines', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p', 0, { isDynamic: true, dynamicFields: ['name'] })]]);
			provider.setOptions({ groupBy: 'file' });

			const [file] = await provider.getChildren();
			const [item] = await provider.getChildren(file);
			assert.strictEqual(item.description, '~ A.kt (1)');
			assert.strictEqual(tooltipOf(item), [
				'**Data Pack** `p`',
				'$(package) `p/pack.mcmeta`',
				`$(file) [\`${pathA}:1\`](${fileA.with({ fragment: 'L1' })})`,
				'$(warning) _At least one part is computed at runtime, shown as its source snippet._',
			].join('  \n'));
		});

		test('expose every copyable value and flag them in the contextValue for the menu when-clauses', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'main', 2, { dataPackName: 'p' }), element(fileA, 'BIOME', 'b', 3, { dataPackName: 'p' })]]);
			provider.setOptions({ groupBy: 'file' });

			const [file] = await provider.getChildren();
			const [biome, fn] = await provider.getChildren(file);

			assert.deepStrictEqual(fn.values, {
				command: '/function p:main',
				declarationPath: `${pathA}:3`,
				filePath: fileA.fsPath,
				name: 'main',
				namespace: 'p',
				outputPath: 'data/p/function/main.mcfunction',
				resourceLocation: 'p:main',
			});
			assert.strictEqual(fn.contextValue, 'element command declarationPath filePath name namespace outputPath resourceLocation');
			assert.strictEqual(biome.values.command, undefined);
			assert.strictEqual(biome.contextValue, 'element declarationPath filePath name namespace outputPath resourceLocation');
		});
	});

	suite('container items', () => {
		test('a declared datapack root copies its own source, pack.mcmeta and subtree, an unknown one only its subtree', async () => {
			// Two datapacks, so the sole-datapack fallback doesn't adopt the orphan.
			seed([fileA, [element(fileA, 'DATA_PACK', 'p', 1), element(fileA, 'DATA_PACK', 'q', 2), element(fileA, 'BLOCK_TAG', 'logs', 3, { dataPackName: 'p' })]], [fileB, [element(fileB, 'FUNCTION', 'orphan')]]);

			const [declared, , unknown] = await provider.getChildren();
			assert.deepStrictEqual(declared.values, {
				declarationPath: `${pathA}:2`,
				filePath: fileA.fsPath,
				name: 'p',
				namespace: 'p',
				outputPath: 'p/pack.mcmeta',
				outputPaths: 'data/p/tags/block/logs.json',
				resourceLocations: '#p:logs',
			});
			assert.strictEqual(declared.contextValue, 'datapack declarationPath filePath name namespace outputPath outputPaths resourceLocations');
			assert.strictEqual(tooltipOf(declared), [
				'**Data Pack** `p`',
				`File: [\`${pathA}:2\`](${fileA.with({ fragment: 'L2' })})`,
				'Output Path: `p/`',
				'Elements: 1',
				'Namespaces: `p`',
				'Kinds: `Block Tag`',
				'Files: `A.kt`',
			].join('  \n'));
			assert.deepStrictEqual(unknown.values, {
				outputPaths: `data/${UNKNOWN_DATA_PACK}/function/orphan.mcfunction`,
				resourceLocations: `${UNKNOWN_DATA_PACK}:orphan`,
			});
			assert.strictEqual(tooltipOf(unknown).split('  \n')[1], 'Elements: 1');
		});

		test('categories and groups copy the output folder they map to and their subtree', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'dir/main', 0, { dataPackName: 'p' })]]);

			const [root] = await provider.getChildren();
			const [category] = await provider.getChildren(root);
			const [group] = await provider.getChildren(category);
			const subtree = { outputPaths: 'data/p/function/dir/main.mcfunction', resourceLocations: 'p:dir/main' };
			assert.deepStrictEqual(category.values, { name: 'Function', namespace: 'p', outputPath: 'data/p/function', ...subtree });
			assert.deepStrictEqual(group.values, { name: 'dir', namespace: 'p', outputPath: 'data/p/function/dir', ...subtree });
			assert.strictEqual(tooltipOf(category), '**Function** declarations of `p`  \nOutput Path: `data/p/function/`  \nElements: 1  \nFiles: `A.kt`');
			assert.strictEqual(tooltipOf(group), '**Function** `dir`  \nOutput Path: `data/p/function/dir/`  \nElements: 1  \nFiles: `A.kt`');
		});

		test('long value lists in tooltips are cut at 8 distinct entries', async () => {
			seed([fileA, Array.from({ length: 10 }, (_, i) => element(fileA, 'FUNCTION', `f${i}`, i, { dataPackName: 'p', namespace: `ns${i}` }))]);

			const [root] = await provider.getChildren();
			assert.ok(tooltipOf(root).includes('Namespaces: `ns0`, `ns1`, `ns2`, `ns3`, `ns4`, `ns5`, `ns6`, `ns7`, +2 more'));
		});

		test('a file root copies its absolute and workspace-relative path', async () => {
			seed([fileA, [element(fileA, 'FUNCTION', 'f')]]);
			provider.setOptions({ groupBy: 'file' });

			const [file] = await provider.getChildren();
			assert.deepStrictEqual(file.values, {
				declarationPath: pathA,
				filePath: fileA.fsPath,
				name: 'A.kt',
				outputPaths: `data/${UNKNOWN_DATA_PACK}/function/f.mcfunction`,
				resourceLocations: `${UNKNOWN_DATA_PACK}:f`,
			});
			assert.strictEqual(file.contextValue, 'file declarationPath filePath name outputPaths resourceLocations');
		});

		test('icons come from the extension assets per kind family', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'TICK', 't', 1), element(fileA, 'BIOME', 'b', 2)]]);
			provider.setOptions({ groupBy: 'file', sortBy: 'kind' });

			const [file] = await provider.getChildren();
			const items = await provider.getChildren(file);
			const iconNames = items.map(i => (i.iconPath as { dark: vscode.Uri }).dark.path.split('/').pop());
			assert.deepStrictEqual(iconNames, ['datapack-dark.svg', 'function-dark.svg', 'json-dark.svg']);
		});
	});

	suite('findItem', () => {
		test('walks down to the leaf under every grouping, with a parent chain reveal can follow', async () => {
			seed([fileA, [element(fileA, 'DATA_PACK', 'p'), element(fileA, 'FUNCTION', 'dir/leaf', 1, { dataPackName: 'p' })]]);
			const [dataPack, leaf] = koreElementManager.getElementsForUri(fileA);

			for (const groupBy of ['output', 'kind', 'file', 'flat'] as const) {
				provider.setOptions({ groupBy });
				const item = provider.findItem(leaf)!;
				assert.strictEqual(item.element, leaf, groupBy);
				const chain: string[] = [];
				for (let node: KoreTreeItem | undefined = item; node; node = provider.getParent(node)) {
					chain.unshift(node.type);
				}
				assert.deepStrictEqual(chain, {
					output: ['datapack', 'namespace', 'folder', 'group', 'element'],
					kind: ['datapack', 'category', 'group', 'element'],
					file: ['file', 'element'],
					flat: ['element'],
				}[groupBy]);
			}

			provider.setOptions({ groupBy: 'kind' });
			assert.strictEqual(provider.findItem(dataPack)?.type, 'datapack');
			provider.setOptions({ filter: 'nothing' });
			assert.strictEqual(provider.findItem(leaf), undefined);
		});
	});
});
