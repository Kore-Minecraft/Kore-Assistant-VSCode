// Port of io.github.ayfri.kore.koreassistant.index.KoreDeclarationKind + the KoreElement.kt path formulas,
// from https://github.com/Kore-Minecraft/Kore-Assistant-Intellij. Regenerate on every Kore MC-version bump.

export const FUNCTION_RESOURCE_FOLDER = 'function';

export interface KoreDeclarationKind {
	/** Stable id, same spelling as the IntelliJ plugin's enum entry (e.g. `CRAFTING_SHAPED`). */
	id: string;
	/** The callee identifier the parser looks for, e.g. `craftingShaped` in `craftingShaped("x") { }`. */
	builderName: string;
	/** Folder under `data/<namespace>/` the resource is written to. `undefined` only for `DATA_PACK`. */
	resourceFolder?: string;
}

// Two known upstream quirks mirrored here rather than "fixed", so the plugin matches actual Kore output:
// - the enchantment-provider builders register with resourceFolder "trades" (should be "enchantment_provider"),
//   a copy-paste bug in Kore's EnchantmentProvider.kt.
// - Tag overrides getPathFromDataDir to nest under tags/<type>/<file>.json, not a flat resourceFolder, so tags
//   are intentionally not in this table yet.
export const KORE_DECLARATION_KINDS: KoreDeclarationKind[] = [
	{ id: 'ADVANCEMENT', builderName: 'advancement', resourceFolder: 'advancement' },
	{ id: 'BANNER_PATTERN', builderName: 'bannerPattern', resourceFolder: 'banner_pattern' },
	{ id: 'BIOME', builderName: 'biome', resourceFolder: 'worldgen/biome' },
	{ id: 'BLASTING', builderName: 'blasting', resourceFolder: 'recipe' },
	{ id: 'BURIED_TREASURE', builderName: 'buriedTreasure', resourceFolder: 'worldgen/structure' },
	{ id: 'BY_COST_ENCHANTMENT_PROVIDER', builderName: 'byCostEnchantmentProvider', resourceFolder: 'trades' },
	{ id: 'BY_COST_WITH_DIFFICULTY_ENCHANTMENT_PROVIDER', builderName: 'byCostWithDifficultyEnchantmentProvider', resourceFolder: 'trades' },
	{ id: 'CAMPFIRE_COOKING', builderName: 'campfireCooking', resourceFolder: 'recipe' },
	{ id: 'CAT_SOUND_VARIANT', builderName: 'catSoundVariant', resourceFolder: 'cat_sound_variant' },
	{ id: 'CAT_VARIANT', builderName: 'catVariant', resourceFolder: 'cat_variant' },
	{ id: 'CHAT_TYPE', builderName: 'chatType', resourceFolder: 'chat_type' },
	{ id: 'CHICKEN_SOUND_VARIANT', builderName: 'chickenSoundVariant', resourceFolder: 'chicken_sound_variant' },
	{ id: 'CHICKEN_VARIANT', builderName: 'chickenVariant', resourceFolder: 'chicken_variant' },
	{ id: 'CONFIGURED_CARVER', builderName: 'configuredCarver', resourceFolder: 'worldgen/configured_carver' },
	{ id: 'CONFIGURED_FEATURE', builderName: 'configuredFeature', resourceFolder: 'worldgen/configured_feature' },
	{ id: 'CONFIRMATION', builderName: 'confirmation', resourceFolder: 'dialog' },
	{ id: 'COW_SOUND_VARIANT', builderName: 'cowSoundVariant', resourceFolder: 'cow_sound_variant' },
	{ id: 'COW_VARIANT', builderName: 'cowVariant', resourceFolder: 'cow_variant' },
	{ id: 'CRAFTING_DECORATED_POT', builderName: 'craftingDecoratedPot', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_DYE', builderName: 'craftingDye', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_IMBUE', builderName: 'craftingImbue', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SHAPED', builderName: 'craftingShaped', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SHAPELESS', builderName: 'craftingShapeless', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL', builderName: 'craftingSpecial', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_BANNER_DUPLICATE', builderName: 'craftingSpecialBannerDuplicate', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_BOOK_CLONING', builderName: 'craftingSpecialBookCloning', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_ROCKET', builderName: 'craftingSpecialFireworkRocket', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_STAR', builderName: 'craftingSpecialFireworkStar', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_STAR_FADE', builderName: 'craftingSpecialFireworkStarFade', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_MAP_EXTENDING', builderName: 'craftingSpecialMapExtending', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_SPECIAL_SHIELD_DECORATION', builderName: 'craftingSpecialShieldDecoration', resourceFolder: 'recipe' },
	{ id: 'CRAFTING_TRANSMUTE', builderName: 'craftingTransmute', resourceFolder: 'recipe' },
	{ id: 'DAMAGE_TYPE', builderName: 'damageType', resourceFolder: 'damage_type' },
	{ id: 'DATA_PACK', builderName: 'dataPack' },
	{ id: 'DENSITY_FUNCTION', builderName: 'densityFunction', resourceFolder: 'worldgen/density_function' },
	{ id: 'DESERT_PYRAMID', builderName: 'desertPyramid', resourceFolder: 'worldgen/structure' },
	{ id: 'DIALOG_LIST', builderName: 'dialogList', resourceFolder: 'dialog' },
	{ id: 'DIMENSION', builderName: 'dimension', resourceFolder: 'dimension' },
	{ id: 'DIMENSION_TYPE', builderName: 'dimensionType', resourceFolder: 'dimension_type' },
	{ id: 'ENCHANTMENT', builderName: 'enchantment', resourceFolder: 'enchantment' },
	{ id: 'END_CITY', builderName: 'endCity', resourceFolder: 'worldgen/structure' },
	{ id: 'FLAT_LEVEL_GENERATOR_PRESET', builderName: 'flatLevelGeneratorPreset', resourceFolder: 'worldgen/flat_level_generator_preset' },
	{ id: 'FORTRESS', builderName: 'fortress', resourceFolder: 'worldgen/structure' },
	{ id: 'FROG_VARIANT', builderName: 'frogVariant', resourceFolder: 'frog_variant' },
	{ id: 'FUNCTION', builderName: 'function', resourceFolder: 'function' },
	{ id: 'GENERATED_FUNCTION', builderName: 'generatedFunction', resourceFolder: 'function' },
	{ id: 'IGLOO', builderName: 'igloo', resourceFolder: 'worldgen/structure' },
	{ id: 'INSTRUMENT', builderName: 'instrument', resourceFolder: 'instrument' },
	{ id: 'ITEM_MODIFIER', builderName: 'itemModifier', resourceFolder: 'item_modifier' },
	{ id: 'JIGSAW', builderName: 'jigsaw', resourceFolder: 'worldgen/structure' },
	{ id: 'JUKEBOX_SONG', builderName: 'jukeboxSong', resourceFolder: 'jukebox_song' },
	{ id: 'JUNGLE_TEMPLE', builderName: 'jungleTemple', resourceFolder: 'worldgen/structure' },
	{ id: 'LOAD', builderName: 'load', resourceFolder: 'function' },
	{ id: 'LOOT_TABLE', builderName: 'lootTable', resourceFolder: 'loot_table' },
	{ id: 'MINESHAFT', builderName: 'mineshaft', resourceFolder: 'worldgen/structure' },
	{ id: 'MULTI_ACTION', builderName: 'multiAction', resourceFolder: 'dialog' },
	{ id: 'NETHER_FOSSIL', builderName: 'netherFossil', resourceFolder: 'worldgen/structure' },
	{ id: 'NOISE', builderName: 'noise', resourceFolder: 'worldgen/noise' },
	{ id: 'NOISE_SETTINGS', builderName: 'noiseSettings', resourceFolder: 'worldgen/noise_settings' },
	{ id: 'NOTICE', builderName: 'notice', resourceFolder: 'dialog' },
	{ id: 'OCEAN_MONUMENT', builderName: 'oceanMonument', resourceFolder: 'worldgen/structure' },
	{ id: 'OCEAN_RUIN', builderName: 'oceanRuin', resourceFolder: 'worldgen/structure' },
	{ id: 'PAINTING_VARIANT', builderName: 'paintingVariant', resourceFolder: 'painting_variant' },
	{ id: 'PIG_SOUND_VARIANT', builderName: 'pigSoundVariant', resourceFolder: 'pig_sound_variant' },
	{ id: 'PIG_VARIANT', builderName: 'pigVariant', resourceFolder: 'pig_variant' },
	{ id: 'PLACED_FEATURE', builderName: 'placedFeature', resourceFolder: 'worldgen/placed_feature' },
	{ id: 'PREDICATE', builderName: 'predicate', resourceFolder: 'predicate' },
	{ id: 'PROCESSOR_LIST', builderName: 'processorList', resourceFolder: 'worldgen/processor_list' },
	{ id: 'RUINED_PORTAL', builderName: 'ruinedPortal', resourceFolder: 'worldgen/structure' },
	{ id: 'SERVER_LINKS', builderName: 'serverLinks', resourceFolder: 'dialog' },
	{ id: 'SHIP_WRECK', builderName: 'shipWreck', resourceFolder: 'worldgen/structure' },
	{ id: 'SINGLE_ENCHANTMENT_PROVIDER', builderName: 'singleEnchantmentProvider', resourceFolder: 'trades' },
	{ id: 'SMELTING', builderName: 'smelting', resourceFolder: 'recipe' },
	{ id: 'SMITHING_TRANSFORM', builderName: 'smithingTransform', resourceFolder: 'recipe' },
	{ id: 'SMITHING_TRIM', builderName: 'smithingTrim', resourceFolder: 'recipe' },
	{ id: 'SMOKING', builderName: 'smoking', resourceFolder: 'recipe' },
	{ id: 'STONE_CUTTING', builderName: 'stoneCutting', resourceFolder: 'recipe' },
	{ id: 'STRONGHOLD', builderName: 'stronghold', resourceFolder: 'worldgen/structure' },
	{ id: 'STRUCTURE_SET', builderName: 'structureSet', resourceFolder: 'worldgen/structure_set' },
	{ id: 'SWAMP_HUT', builderName: 'swampHut', resourceFolder: 'worldgen/structure' },
	{ id: 'TEMPLATE_POOL', builderName: 'templatePool', resourceFolder: 'worldgen/template_pool' },
	{ id: 'TEST_ENVIRONMENT', builderName: 'testEnvironment', resourceFolder: 'test_environment' },
	{ id: 'TEST_INSTANCE', builderName: 'testInstance', resourceFolder: 'test_instance' },
	{ id: 'TICK', builderName: 'tick', resourceFolder: 'function' },
	{ id: 'TIMELINE', builderName: 'timeline', resourceFolder: 'timeline' },
	{ id: 'TRADE_SET', builderName: 'tradeSet', resourceFolder: 'trade_set' },
	{ id: 'TRIM_MATERIAL', builderName: 'trimMaterial', resourceFolder: 'trim_material' },
	{ id: 'TRIM_PATTERN', builderName: 'trimPattern', resourceFolder: 'trim_pattern' },
	{ id: 'VILLAGER_TRADE', builderName: 'villagerTrade', resourceFolder: 'villager_trade' },
	{ id: 'WOLF_SOUND_VARIANT', builderName: 'wolfSoundVariant', resourceFolder: 'wolf_sound_variant' },
	{ id: 'WOLF_VARIANT', builderName: 'wolfVariant', resourceFolder: 'wolf_variant' },
	{ id: 'WOODLAND_MANSION', builderName: 'woodlandMansion', resourceFolder: 'worldgen/structure' },
	{ id: 'WORLD_CLOCK', builderName: 'worldClock', resourceFolder: 'world_clock' },
	{ id: 'WORLD_PRESET', builderName: 'worldPreset', resourceFolder: 'worldgen/world_preset' },
	{ id: 'ZOMBIE_NAUTILUS_VARIANT', builderName: 'zombieNautilusVariant', resourceFolder: 'zombie_nautilus_variant' },
];

export const DATA_PACK_KIND = KORE_DECLARATION_KINDS.find(k => k.id === 'DATA_PACK')!;

const kindsByBuilderName = new Map(KORE_DECLARATION_KINDS.map(kind => [kind.builderName, kind]));
const kindsById = new Map(KORE_DECLARATION_KINDS.map(kind => [kind.id, kind]));

export function kindByBuilderName(builderName: string): KoreDeclarationKind | undefined {
	return kindsByBuilderName.get(builderName);
}

export function kindById(id: string): KoreDeclarationKind | undefined {
	return kindsById.get(id);
}

/** The function family writes `.mcfunction` under an extra `directory` instead of `folder/name.json`. */
export function isFunctionKind(kind: KoreDeclarationKind): boolean {
	return kind.resourceFolder === FUNCTION_RESOURCE_FOLDER;
}

/** `CRAFTING_SHAPED` -> `Crafting Shaped`, for tooltips and tree grouping. */
export function displayNameFor(kind: KoreDeclarationKind): string {
	return kind.id
		.split('_')
		.map(word => word.charAt(0) + word.slice(1).toLowerCase())
		.join(' ');
}

function withTrailingSlash(value: string): string {
	return value === '' || value.endsWith('/') ? value : `${value}/`;
}

export interface KoreElementPathParts {
	kind: KoreDeclarationKind;
	name: string;
	namespace: string;
	directory?: string;
}

/** Where Kore will write this element, relative to the datapack folder. Mirrors `Generator.getPathFromDataDir`. */
export function outputPathFor({ kind, name, namespace, directory }: KoreElementPathParts): string {
	if (kind.id === 'DATA_PACK') {
		return `${name}/pack.mcmeta`;
	}

	if (isFunctionKind(kind)) {
		return `data/${namespace}/function/${withTrailingSlash(directory ?? '')}${name}.mcfunction`;
	}

	return `data/${namespace}/${kind.resourceFolder}/${name}.json`;
}

/** The `namespace:path` id used in-game and in other Kore calls. A datapack is a container, so it has none. */
export function resourceLocationFor({ kind, name, namespace, directory }: KoreElementPathParts): string | undefined {
	if (kind.id === 'DATA_PACK') {
		return undefined;
	}

	if (isFunctionKind(kind)) {
		return `${namespace}:${withTrailingSlash(directory ?? '')}${name}`;
	}

	return `${namespace}:${name}`;
}

const COMMAND_BY_RESOURCE_FOLDER: Record<string, (location: string) => string> = {
	advancement: location => `/advancement grant @s only ${location}`,
	damage_type: location => `/damage @s 1 ${location}`,
	dialog: location => `/dialog show @s ${location}`,
	enchantment: location => `/enchant @s ${location}`,
	item_modifier: location => `/item modify entity @s weapon.mainhand ${location}`,
	loot_table: location => `/loot give @s loot ${location}`,
	predicate: location => `/execute if predicate ${location} run say matched`,
	recipe: location => `/recipe give @s ${location}`,
	'worldgen/configured_feature': location => `/place feature ${location}`,
	'worldgen/placed_feature': location => `/place feature ${location}`,
	'worldgen/structure': location => `/place structure ${location}`,
	'worldgen/template_pool': location => `/place template ${location}`,
};

/** The command that runs or grants this resource, for the kinds that have one. */
export function commandFor(parts: KoreElementPathParts): string | undefined {
	const location = resourceLocationFor(parts);
	if (!location) {
		return undefined;
	}

	if (isFunctionKind(parts.kind)) {
		return `/function ${location}`;
	}

	return parts.kind.resourceFolder ? COMMAND_BY_RESOURCE_FOLDER[parts.kind.resourceFolder]?.(location) : undefined;
}
