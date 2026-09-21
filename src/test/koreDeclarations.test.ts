import * as assert from 'assert';
import {
	commandFor,
	DATA_PACK_KIND,
	DENSITY_FUNCTIONS_SCOPE,
	displayNameFor,
	isFunctionKind,
	isTagKind,
	kindByBuilderName,
	kindById,
	KORE_DECLARATION_KINDS,
	KORE_SCOPES,
	outputPathFor,
	RECIPES_SCOPE,
	resourceLocationFor,
	TEST_ENVIRONMENTS_SCOPE,
} from '../koreDeclarations';

const FUNCTION = kindById('FUNCTION')!;
const ADVANCEMENT = kindById('ADVANCEMENT')!;
const BIOME = kindById('BIOME')!;

suite('koreDeclarations', () => {
	suite('kind table', () => {
		test('ids are unique, builder names are unique per scope', () => {
			const ids = new Set(KORE_DECLARATION_KINDS.map(k => k.id));
			const builders = new Set(KORE_DECLARATION_KINDS.map(k => `${k.scope?.builderName ?? ''}.${k.builderName}`));
			assert.strictEqual(ids.size, KORE_DECLARATION_KINDS.length);
			assert.strictEqual(builders.size, KORE_DECLARATION_KINDS.length);
		});

		test('every scope is listed in KORE_SCOPES', () => {
			for (const kind of KORE_DECLARATION_KINDS) {
				if (kind.scope) {
					assert.ok(KORE_SCOPES.includes(kind.scope), `${kind.id} uses an unlisted scope`);
				}
			}
		});

		test('only DATA_PACK has no resource folder', () => {
			const withoutFolder = KORE_DECLARATION_KINDS.filter(k => k.resourceFolder === undefined).map(k => k.id);
			assert.deepStrictEqual(withoutFolder, ['DATA_PACK']);
			assert.strictEqual(DATA_PACK_KIND.builderName, 'dataPack');
		});

		test('lookups by builder name and id agree, unknown names return undefined', () => {
			assert.strictEqual(kindByBuilderName('craftingShaped', new Set([RECIPES_SCOPE])), kindById('CRAFTING_SHAPED'));
			assert.strictEqual(kindByBuilderName('CRAFTING_SHAPED'), undefined);
			assert.strictEqual(kindById('craftingShaped'), undefined);
			assert.strictEqual(kindByBuilderName('nope'), undefined);
		});

		test('a scoped builder name resolves to the scoped kind only inside its scope', () => {
			assert.strictEqual(kindByBuilderName('craftingShaped'), undefined, 'a scoped kind never resolves without its scope');
			assert.strictEqual(kindByBuilderName('noise'), kindById('NOISE'));
			assert.strictEqual(kindByBuilderName('noise', new Set([DENSITY_FUNCTIONS_SCOPE])), kindById('NOISE_DENSITY_FUNCTION'));
			assert.strictEqual(kindByBuilderName('noise', new Set([RECIPES_SCOPE])), kindById('NOISE'));
			assert.strictEqual(kindByBuilderName('function'), kindById('FUNCTION'));
			assert.strictEqual(kindByBuilderName('function', new Set([TEST_ENVIRONMENTS_SCOPE])), kindById('FUNCTION_TEST_ENVIRONMENT'));
		});

		test('the current Kore builder names are used, not the pre-26.2 ones', () => {
			assert.strictEqual(kindById('SHIPWRECK')!.builderName, 'shipwreck');
			assert.strictEqual(kindById('SINGLE_ENCHANTMENT_PROVIDER')!.builderName, 'single');
			assert.strictEqual(kindById('SINGLE_ENCHANTMENT_PROVIDER')!.resourceFolder, 'enchantment_provider');
			assert.strictEqual(kindByBuilderName('densityFunction'), undefined);
			assert.strictEqual(kindByBuilderName('shipWreck'), undefined);
			assert.strictEqual(kindByBuilderName('singleEnchantmentProvider'), undefined);
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

		test('tags nest under tags/<type>/, scoped kinds under their family folder', () => {
			assert.strictEqual(outputPathFor({ kind: kindById('BLOCK_TAG')!, name: 'ores', namespace: 'ns' }), 'data/ns/tags/block/ores.json');
			assert.strictEqual(outputPathFor({ kind: kindById('BIOME_TAG')!, name: 'hot', namespace: 'ns' }), 'data/ns/tags/worldgen/biome/hot.json');
			assert.strictEqual(outputPathFor({ kind: kindById('ORE_FEATURE')!, name: 'ruby', namespace: 'ns' }), 'data/ns/worldgen/configured_feature/ruby.json');
			assert.strictEqual(outputPathFor({ kind: kindById('SINGLE_ENCHANTMENT_PROVIDER')!, name: 'p', namespace: 'ns' }), 'data/ns/enchantment_provider/p.json');
		});
	});

	test('isTagKind is true for every xxxTag builder and nothing else', () => {
		for (const kind of KORE_DECLARATION_KINDS) {
			assert.strictEqual(isTagKind(kind), kind.builderName.endsWith('Tag'), kind.id);
		}
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

		test('tags are #namespace:name', () => {
			assert.strictEqual(resourceLocationFor({ kind: kindById('ITEM_TAG')!, name: 'gems', namespace: 'ns' }), '#ns:gems');
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
			assert.strictEqual(commandFor({ kind: kindById('FUNCTION_TAG')!, name: 't', namespace: 'ns' }), '/function #ns:t');
			assert.strictEqual(commandFor({ kind: kindById('TREE_FEATURE')!, name: 'oak', namespace: 'ns' }), '/place feature ns:oak');
			assert.strictEqual(commandFor({ kind: kindById('STRUCTURE')!, name: 's', namespace: 'ns' }), '/place structure ns:s');
		});

		test('kinds without an in-game command return undefined', () => {
			assert.strictEqual(commandFor({ kind: BIOME, name: 'plains', namespace: 'ns' }), undefined);
			assert.strictEqual(commandFor({ kind: kindById('CAT_VARIANT')!, name: 'c', namespace: 'ns' }), undefined);
		});
	});
});
