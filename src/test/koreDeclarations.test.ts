import * as assert from 'assert';
import {
	commandFor,
	DATA_PACK_KIND,
	displayNameFor,
	isFunctionKind,
	kindByBuilderName,
	kindById,
	KORE_DECLARATION_KINDS,
	outputPathFor,
	resourceLocationFor,
} from '../koreDeclarations';

const FUNCTION = kindById('FUNCTION')!;
const ADVANCEMENT = kindById('ADVANCEMENT')!;
const BIOME = kindById('BIOME')!;

suite('koreDeclarations', () => {
	suite('kind table', () => {
		test('ids and builder names are unique', () => {
			const ids = new Set(KORE_DECLARATION_KINDS.map(k => k.id));
			const builders = new Set(KORE_DECLARATION_KINDS.map(k => k.builderName));
			assert.strictEqual(ids.size, KORE_DECLARATION_KINDS.length);
			assert.strictEqual(builders.size, KORE_DECLARATION_KINDS.length);
		});

		test('only DATA_PACK has no resource folder', () => {
			const withoutFolder = KORE_DECLARATION_KINDS.filter(k => k.resourceFolder === undefined).map(k => k.id);
			assert.deepStrictEqual(withoutFolder, ['DATA_PACK']);
			assert.strictEqual(DATA_PACK_KIND.builderName, 'dataPack');
		});

		test('lookups by builder name and id agree, unknown names return undefined', () => {
			assert.strictEqual(kindByBuilderName('craftingShaped'), kindById('CRAFTING_SHAPED'));
			assert.strictEqual(kindByBuilderName('CRAFTING_SHAPED'), undefined);
			assert.strictEqual(kindById('craftingShaped'), undefined);
			assert.strictEqual(kindByBuilderName('nope'), undefined);
		});

		test('the function family is every kind writing .mcfunction files', () => {
			const family = KORE_DECLARATION_KINDS.filter(isFunctionKind).map(k => k.id).sort();
			assert.deepStrictEqual(family, ['FUNCTION', 'GENERATED_FUNCTION', 'LOAD', 'TICK']);
		});
	});

	test('displayNameFor title-cases the id words', () => {
		assert.strictEqual(displayNameFor(kindById('CRAFTING_SHAPED')!), 'Crafting Shaped');
		assert.strictEqual(displayNameFor(FUNCTION), 'Function');
		assert.strictEqual(displayNameFor(kindById('BY_COST_WITH_DIFFICULTY_ENCHANTMENT_PROVIDER')!), 'By Cost With Difficulty Enchantment Provider');
	});

	suite('outputPathFor', () => {
		test('datapack writes its pack.mcmeta', () => {
			assert.strictEqual(outputPathFor({ kind: DATA_PACK_KIND, name: 'pack', namespace: 'pack' }), 'pack/pack.mcmeta');
		});

		test('functions land under function/<directory>/', () => {
			assert.strictEqual(outputPathFor({ kind: FUNCTION, name: 'main', namespace: 'ns' }), 'data/ns/function/main.mcfunction');
			assert.strictEqual(outputPathFor({ kind: FUNCTION, name: 'main', namespace: 'ns', directory: 'sub' }), 'data/ns/function/sub/main.mcfunction');
			assert.strictEqual(outputPathFor({ kind: FUNCTION, name: 'main', namespace: 'ns', directory: 'sub/' }), 'data/ns/function/sub/main.mcfunction');
			assert.strictEqual(outputPathFor({ kind: FUNCTION, name: 'main', namespace: 'ns', directory: '' }), 'data/ns/function/main.mcfunction');
		});

		test('json kinds use their resource folder, including nested worldgen folders', () => {
			assert.strictEqual(outputPathFor({ kind: ADVANCEMENT, name: 'root', namespace: 'ns' }), 'data/ns/advancement/root.json');
			assert.strictEqual(outputPathFor({ kind: BIOME, name: 'plains', namespace: 'ns' }), 'data/ns/worldgen/biome/plains.json');
		});

		test('json kinds ignore directory', () => {
			assert.strictEqual(outputPathFor({ kind: ADVANCEMENT, name: 'root', namespace: 'ns', directory: 'sub' }), 'data/ns/advancement/root.json');
		});
	});

	suite('resourceLocationFor', () => {
		test('datapack has none', () => {
			assert.strictEqual(resourceLocationFor({ kind: DATA_PACK_KIND, name: 'pack', namespace: 'pack' }), undefined);
		});

		test('functions include their directory', () => {
			assert.strictEqual(resourceLocationFor({ kind: FUNCTION, name: 'main', namespace: 'ns' }), 'ns:main');
			assert.strictEqual(resourceLocationFor({ kind: FUNCTION, name: 'main', namespace: 'ns', directory: 'a/b' }), 'ns:a/b/main');
		});

		test('json kinds are namespace:name', () => {
			assert.strictEqual(resourceLocationFor({ kind: BIOME, name: 'plains', namespace: 'ns' }), 'ns:plains');
		});
	});

	suite('commandFor', () => {
		test('datapack has no command', () => {
			assert.strictEqual(commandFor({ kind: DATA_PACK_KIND, name: 'pack', namespace: 'pack' }), undefined);
		});

		test('every function-family kind runs with /function', () => {
			for (const id of ['FUNCTION', 'GENERATED_FUNCTION', 'LOAD', 'TICK']) {
				assert.strictEqual(commandFor({ kind: kindById(id)!, name: 'x', namespace: 'ns', directory: 'd' }), '/function ns:d/x');
			}
		});

		test('known resource folders map to their command', () => {
			assert.strictEqual(commandFor({ kind: ADVANCEMENT, name: 'root', namespace: 'ns' }), '/advancement grant @s only ns:root');
			assert.strictEqual(commandFor({ kind: kindById('SMELTING')!, name: 'r', namespace: 'ns' }), '/recipe give @s ns:r');
			assert.strictEqual(commandFor({ kind: kindById('IGLOO')!, name: 's', namespace: 'ns' }), '/place structure ns:s');
			assert.strictEqual(commandFor({ kind: kindById('NOTICE')!, name: 'd', namespace: 'ns' }), '/dialog show @s ns:d');
		});

		test('kinds without an in-game command return undefined', () => {
			assert.strictEqual(commandFor({ kind: BIOME, name: 'plains', namespace: 'ns' }), undefined);
			assert.strictEqual(commandFor({ kind: kindById('CAT_VARIANT')!, name: 'c', namespace: 'ns' }), undefined);
		});
	});
});
