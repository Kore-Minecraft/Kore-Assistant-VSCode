import * as assert from 'assert';
import * as vscode from 'vscode';
import { KoreElement, KoreElementManager, KoreFile, parseKoreFile, UNKNOWN_DATA_PACK } from '../koreElements';

const fileA = vscode.Uri.file('/ws/A.kt');
const fileB = vscode.Uri.file('/ws/B.kt');
const constantsKt = vscode.Uri.file('/ws/Constants.kt');
const otherProject = vscode.Uri.file('/other/Main.kt');

function element(uri: vscode.Uri, kindId: string, name: string, extra: Partial<KoreElement> = {}): KoreElement {
	return { kindId, name, isDynamic: false, dynamicFields: [], offset: 0, nameArgRange: new vscode.Range(0, 0, 0, 0), range: new vscode.Range(0, 0, 0, 1), uri, ...extra };
}

function file(uri: vscode.Uri, text: string): KoreFile {
	return parseKoreFile(text, uri);
}

suite('KoreElementManager', () => {
	let manager: KoreElementManager;
	let changes: number;

	setup(() => {
		manager = new KoreElementManager();
		changes = 0;
		manager.onDidChangeElements(() => changes++);
	});

	test('starts empty', () => {
		assert.deepStrictEqual(manager.getElements(), []);
	});

	test('resolves paths, namespace and command from the element data', () => {
		manager.replaceElementsForUri(fileA, [
			element(fileA, 'DATA_PACK', 'pack'),
			element(fileA, 'FUNCTION', 'main', { dataPackName: 'pack', directory: 'sub' }),
			element(fileA, 'ADVANCEMENT', 'root', { dataPackName: 'pack', namespace: 'story' }),
		]);

		const [pack, fn, adv] = manager.getElements();
		assert.strictEqual(pack.resolvedDataPackName, 'pack');
		assert.strictEqual(pack.resolvedNamespace, 'pack');
		assert.strictEqual(pack.outputPath, 'pack/pack.mcmeta');
		assert.strictEqual(pack.resourceLocation, undefined);
		assert.strictEqual(pack.command, undefined);

		assert.strictEqual(fn.resolvedNamespace, 'pack');
		assert.strictEqual(fn.outputPath, 'data/pack/function/sub/main.mcfunction');
		assert.strictEqual(fn.resourceLocation, 'pack:sub/main');
		assert.strictEqual(fn.command, '/function pack:sub/main');

		assert.strictEqual(adv.resolvedNamespace, 'story');
		assert.strictEqual(adv.resolvedDataPackName, 'pack');
		assert.strictEqual(adv.outputPath, 'data/story/advancement/root.json');
	});

	test('falls back to the sole workspace datapack for elements without one, across files', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'DATA_PACK', 'only')]],
			[fileB, [element(fileB, 'FUNCTION', 'orphan')]],
		]);

		const orphan = manager.getElementsForUri(fileB)[0];
		assert.strictEqual(orphan.resolvedDataPackName, 'only');
		assert.strictEqual(orphan.resolvedNamespace, 'only');
		assert.strictEqual(orphan.outputPath, 'data/only/function/orphan.mcfunction');
	});

	test('uses the unknown placeholder when there is no datapack or more than one', () => {
		manager.replaceElementsForUri(fileB, [element(fileB, 'FUNCTION', 'orphan')]);
		assert.strictEqual(manager.getElements()[0].resolvedDataPackName, UNKNOWN_DATA_PACK);
		assert.strictEqual(manager.getElements()[0].resolvedNamespace, UNKNOWN_DATA_PACK);

		manager.replaceElementsForUri(fileA, [element(fileA, 'DATA_PACK', 'one'), element(fileA, 'DATA_PACK', 'two')]);
		assert.strictEqual(manager.getElementsForUri(fileB)[0].resolvedDataPackName, UNKNOWN_DATA_PACK);
	});

	test('the same datapack declared twice still counts as a sole datapack', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'DATA_PACK', 'same')]],
			[fileB, [element(fileB, 'DATA_PACK', 'same'), element(fileB, 'FUNCTION', 'f')]],
		]);
		assert.strictEqual(manager.getElementsByKindId('FUNCTION')[0].resolvedDataPackName, 'same');
	});

	test('an explicit dataPackName wins over the sole-datapack fallback', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'DATA_PACK', 'only')]],
			[fileB, [element(fileB, 'FUNCTION', 'f', { dataPackName: 'explicit' })]],
		]);
		assert.strictEqual(manager.getElementsByKindId('FUNCTION')[0].resolvedDataPackName, 'explicit');
	});

	test('replacing a file swaps its elements, an empty list or a removal drops it', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'FUNCTION', 'a1')]],
			[fileB, [element(fileB, 'FUNCTION', 'b1')]],
		]);
		manager.replaceElementsForUri(fileA, [element(fileA, 'FUNCTION', 'a2')]);
		assert.deepStrictEqual(manager.getElements().map(e => e.name).sort(), ['a2', 'b1']);

		manager.replaceElementsForUri(fileA, []);
		assert.deepStrictEqual(manager.getElements().map(e => e.name), ['b1']);

		manager.removeElementsForUris([fileB]);
		assert.deepStrictEqual(manager.getElements(), []);
	});

	test('fires exactly one change event per batch operation', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'FUNCTION', 'a')]],
			[fileB, [element(fileB, 'FUNCTION', 'b')]],
		]);
		assert.strictEqual(changes, 1);

		manager.replaceElementsForUri(fileA, [element(fileA, 'FUNCTION', 'a'), element(fileA, 'FUNCTION', 'c')]);
		assert.strictEqual(changes, 2);

		manager.removeElementsForUris([fileA, fileB]);
		assert.strictEqual(changes, 3);
	});

	test('caches the resolved list and its indexes until the next change', () => {
		manager.replaceElementsForUri(fileA, [element(fileA, 'FUNCTION', 'a')]);
		const first = manager.getElements();
		assert.strictEqual(manager.getElements(), first);
		assert.strictEqual(manager.getElementsForUri(fileA), manager.getElementsForUri(fileA));
		assert.strictEqual(manager.getElementsByKindId('FUNCTION'), manager.getElementsByKindId('FUNCTION'));

		manager.replaceElementsForUri(fileB, [element(fileB, 'DATA_PACK', 'p')]);
		const second = manager.getElements();
		assert.notStrictEqual(second, first);
		assert.strictEqual(second.find(e => e.name === 'a')!.resolvedDataPackName, 'p');
		assert.strictEqual(manager.getElementsForUri(fileA)[0].resolvedDataPackName, 'p');
	});

	test('filters by uri and by kind', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'FUNCTION', 'a'), element(fileA, 'LOOT_TABLE', 'l')]],
			[fileB, [element(fileB, 'FUNCTION', 'b')]],
		]);

		assert.deepStrictEqual(manager.getElementsForUri(fileA).map(e => e.name), ['a', 'l']);
		assert.deepStrictEqual(manager.getElementsByKindId('FUNCTION').map(e => e.name), ['a', 'b']);
		assert.deepStrictEqual(manager.getElementsByKindId('NOPE'), []);
	});

	suite('constant resolution', () => {
		const names = (uri: vscode.Uri) => manager.getElementsForUri(uri).map(e => [e.name, e.isDynamic]);

		test('resolves a constant datapack name and string-template parts from a `val` in another file', () => {
			manager.replaceElementsForUris([
				[constantsKt, file(constantsKt, 'const val NAMESPACE = "lifesteal"\nval LEAF = "oak"')],
				[fileA, file(fileA, 'dataPack(NAMESPACE) { lootTable("blocks/${LEAF}_$LEAF") { } }')],
			]);

			const [loot, pack] = manager.getElementsForUri(fileA);
			assert.strictEqual(pack.name, 'lifesteal');
			assert.strictEqual(pack.isDynamic, false);
			assert.strictEqual(loot.name, 'blocks/oak_oak');
			assert.strictEqual(loot.resolvedDataPackName, 'lifesteal');
			assert.strictEqual(loot.outputPath, 'data/lifesteal/loot_table/blocks/oak_oak.json');
			assert.strictEqual(loot.isDynamic, false);
		});

		test('keeps the snippet, marked dynamic, when a constant is unknown or bound differently across files', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'val X = "a"\nfunction(X) { }\nfunction(Y) { }')],
				[fileB, file(fileB, 'val X = "b"\nfunction(X) { }')],
				[constantsKt, file(constantsKt, 'function(X) { }')],
			]);

			assert.deepStrictEqual(names(fileA), [['a', false], ['Y', true]]);
			assert.deepStrictEqual(names(fileB), [['b', false]]);
			assert.deepStrictEqual(names(constantsKt), [['X', true]]);
		});

		test('follows dot-qualified references on their last segment and concatenations', () => {
			manager.replaceElementsForUris([
				[constantsKt, file(constantsKt, 'object Names { const val PREFIX = "blocks/"; val LEAF = "oak" }')],
				[fileA, file(fileA, 'dataPack("p") { lootTable(Names.PREFIX + Names.LEAF + "_log") { }\nfunction("f_" + this.LEAF) { } }')],
			]);

			assert.deepStrictEqual(names(fileA), [['blocks/oak_log', false], ['f_oak', false], ['p', false]]);
		});

		test('follows `val A = B` chains and templates inside constants, giving up on a cycle', () => {
			manager.replaceElementsForUris([
				[constantsKt, file(constantsKt, 'val BASE = "kore"\nval NS = "${BASE}_pack"\nval ALIAS = NS\nval LOOP_A = LOOP_B\nval LOOP_B = LOOP_A')],
				[fileA, file(fileA, 'dataPack(ALIAS) { function(LOOP_A) { } }')],
			]);

			assert.deepStrictEqual(names(fileA), [['LOOP_A', true], ['kore_pack', false]]);
			assert.strictEqual(manager.getElementsForUri(fileA)[0].resolvedDataPackName, 'kore_pack');
		});

		test('a local `val` shadows the file-level one inside its block only, a file-level one is visible before its line', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'val NAME = "top"\nfun a() { val NAME = "local"; function(NAME) { } }\nfun b() { function(NAME) { } }\nfunction(EARLY) { }\nval EARLY = "early"')],
			]);

			assert.deepStrictEqual(names(fileA).map(([name]) => name), ['local', 'top', 'early']);
		});
	});

	suite('datapack ownership', () => {

		test('follows extension-function calls from a dataPack block, transitively and across files', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'fun main() { dataPack("p") { setup() } }')],
				[fileB, file(fileB, 'fun DataPack.setup() { helper() }\nprivate fun DataPack.helper() { function("h") { } }')],
			]);

			const [h] = manager.getElementsForUri(fileB);
			assert.strictEqual(h.resolvedDataPackName, 'p');
			assert.strictEqual(h.command, '/function p:h');
		});

		test('a function taking the datapack as a parameter or context parameter is owned the same way', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'dataPack("p") { byParam(this); byContext() }\ndataPack("q") { }')],
				[fileB, file(fileB, 'fun byParam(dp: DataPack) { function("a") { } }\ncontext(dp: DataPack) fun byContext() { function("b") { } }')],
			]);

			assert.deepStrictEqual(manager.getElementsForUri(fileB).map(e => e.resolvedDataPackName), ['p', 'p']);
		});

		test('a same-file function of the same name shadows the DataPack extension elsewhere', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'fun Function.tests() { }\nclass T { init { dataPack("unit") { load { tests() } } } }')],
				[fileB, file(fileB, 'fun DataPack.tests() { function("f") { } }\nclass U { init { dataPack("features") { tests() } } }')],
			]);

			assert.strictEqual(manager.getElementsForUri(fileB).find(e => e.name === 'f')!.resolvedDataPackName, 'features');
		});

		test('an extension called from several datapacks falls back to the folder rule', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'dataPack("p") { shared() }\ndataPack("q") { shared() }')],
				[otherProject, file(otherProject, 'fun DataPack.shared() { function("s") { } }\ndataPack("other") { }')],
			]);

			assert.strictEqual(manager.getElementsForUri(otherProject).find(e => e.name === 's')!.resolvedDataPackName, 'other');
		});

		test('picks the nearest folder declaring exactly one datapack, and gives up on a mixed folder', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'dataPack("p") { }')],
				[fileB, file(fileB, 'function("orphan") { }')],
				[otherProject, file(otherProject, 'dataPack("other") { }\nfunction("mine") { }')],
			]);
			assert.strictEqual(manager.getElementsForUri(fileB)[0].resolvedDataPackName, 'p');
			assert.strictEqual(manager.getElementsForUri(otherProject).find(e => e.name === 'mine')!.resolvedDataPackName, 'other');

			manager.replaceElementsForUri(constantsKt, file(constantsKt, 'dataPack("second") { }'));
			assert.strictEqual(manager.getElementsForUri(fileB)[0].resolvedDataPackName, UNKNOWN_DATA_PACK);
		});

		test('a file with only constants or extension functions stays indexed even without declarations', () => {
			manager.replaceElementsForUris([
				[constantsKt, file(constantsKt, 'val N = "pack"')],
				[fileA, file(fileA, 'dataPack(N) { }')],
			]);
			assert.strictEqual(manager.getElements()[0].name, 'pack');
		});
	});
});
