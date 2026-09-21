import * as assert from 'assert';
import * as vscode from 'vscode';
import { KoreElement, KoreElementManager, KoreFile, koreFileFrom, UNKNOWN_DATA_PACK } from '../koreElements';
import { parseKotlinFile } from '../koreParser';

const fileA = vscode.Uri.file('/ws/A.kt');
const fileB = vscode.Uri.file('/ws/B.kt');

function element(uri: vscode.Uri, kindId: string, name: string, extra: Partial<KoreElement> = {}): KoreElement {
	return { kindId, name, isDynamic: false, dynamicFields: [], range: new vscode.Range(0, 0, 0, 1), uri, ...extra };
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

	test('replacing a file swaps its elements and leaves other files alone', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'FUNCTION', 'a1')]],
			[fileB, [element(fileB, 'FUNCTION', 'b1')]],
		]);
		manager.replaceElementsForUri(fileA, [element(fileA, 'FUNCTION', 'a2')]);

		assert.deepStrictEqual(manager.getElements().map(e => e.name).sort(), ['a2', 'b1']);
	});

	test('replacing with an empty list and removing a file both drop it', () => {
		manager.replaceElementsForUris([
			[fileA, [element(fileA, 'FUNCTION', 'a')]],
			[fileB, [element(fileB, 'FUNCTION', 'b')]],
		]);

		manager.replaceElementsForUri(fileA, []);
		assert.deepStrictEqual(manager.getElements().map(e => e.name), ['b']);

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

	test('caches the resolved list until the next change', () => {
		manager.replaceElementsForUri(fileA, [element(fileA, 'FUNCTION', 'a')]);
		const first = manager.getElements();
		assert.strictEqual(manager.getElements(), first);

		manager.replaceElementsForUri(fileB, [element(fileB, 'DATA_PACK', 'p')]);
		const second = manager.getElements();
		assert.notStrictEqual(second, first);
		assert.strictEqual(second.find(e => e.name === 'a')!.resolvedDataPackName, 'p');
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

	suite('workspace resolution', () => {
		const constantsKt = vscode.Uri.file('/ws/Constants.kt');
		const otherProject = vscode.Uri.file('/other/Main.kt');

		function file(uri: vscode.Uri, text: string): KoreFile {
			const parsed = parseKotlinFile(text);
			return koreFileFrom(parsed, parsed.declarations.map(({ offset, ...fields }) => ({
				...fields, range: new vscode.Range(0, offset, 0, offset + 1), uri,
			})));
		}

		teardown(() => manager.removeElementsForUris([constantsKt, otherProject]));

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

			const names = (uri: vscode.Uri) => manager.getElementsForUri(uri).map(e => [e.name, e.isDynamic]);
			assert.deepStrictEqual(names(fileA), [['a', false], ['Y', true]]);
			assert.deepStrictEqual(names(fileB), [['b', false]]);
			assert.deepStrictEqual(names(constantsKt), [['X', true]]);
		});

		test('follows extension-function calls from a dataPack block, transitively and across files', () => {
			manager.replaceElementsForUris([
				[fileA, file(fileA, 'fun main() { dataPack("p") { setup() } }')],
				[fileB, file(fileB, 'fun DataPack.setup() { helper() }\nprivate fun DataPack.helper() { function("h") { } }')],
			]);

			const [h] = manager.getElementsForUri(fileB);
			assert.strictEqual(h.resolvedDataPackName, 'p');
			assert.strictEqual(h.command, '/function p:h');
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
