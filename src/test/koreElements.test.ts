import * as assert from 'assert';
import * as vscode from 'vscode';
import { KoreElement, KoreElementManager, UNKNOWN_DATA_PACK } from '../koreElements';

const fileA = vscode.Uri.file('/ws/A.kt');
const fileB = vscode.Uri.file('/ws/B.kt');

function element(uri: vscode.Uri, kindId: string, name: string, extra: Partial<KoreElement> = {}): KoreElement {
	return { kindId, name, isDynamic: false, range: new vscode.Range(0, 0, 0, 1), uri, ...extra };
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
});
