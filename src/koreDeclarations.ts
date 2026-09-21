// Table of every Kore DSL builder the parser recognizes + the Generator path formulas, kept in sync with the Kore
// sources (`Generator("<resourceFolder>")` subclasses and their `fun DataPack.xxx(` / `fun <Scope>.xxx(` builders).
// Regenerate on every Kore MC-version bump. Last synced with Kore 2.14.0-26.2.

export const FUNCTION_RESOURCE_FOLDER = 'function';

/**
 * A `dataPack.<builderName> { }` block (or its `dataPack.<receiverName>.` property) whose lambda receiver exposes the
 * scoped builders, e.g. `recipes { craftingShaped("x") { } }` or `recipesBuilder.craftingShaped("x") { }`.
 */
export interface KoreScope {
	builderName: string;
	receiverName: string;
}

export interface KoreDeclarationKind {
	/** The callee identifier the parser looks for, e.g. `craftingShaped` in `craftingShaped("x") { }`. */
	builderName: string;
	/** Stable id, `<TYPE>_<FAMILY>` for scoped builders (e.g. `ORE_FEATURE`, `CRAFTING_SHAPED`, `BLOCK_TAG`). */
	id: string;
	/** Folder under `data/<namespace>/` the resource is written to. `undefined` only for `DATA_PACK`. */
	resourceFolder?: string;
	/**
	 * Set when the builder is only reachable inside a scope. The parser then requires the scope as evidence but no
	 * longer requires a trailing lambda, since most scoped builders (`single`, `abs`, `ore`) default their block.
	 */
	scope?: KoreScope;
}

export const RECIPES_SCOPE: KoreScope = { builderName: 'recipes', receiverName: 'recipesBuilder' };
export const DIALOGS_SCOPE: KoreScope = { builderName: 'dialogs', receiverName: 'dialogBuilder' };
export const STRUCTURES_SCOPE: KoreScope = { builderName: 'structures', receiverName: 'structuresBuilder' };
export const ENCHANTMENT_PROVIDERS_SCOPE: KoreScope = { builderName: 'enchantmentProviders', receiverName: 'enchantmentProvidersBuilder' };
export const CONFIGURED_FEATURES_SCOPE: KoreScope = { builderName: 'configuredFeatures', receiverName: 'configuredFeaturesBuilder' };
export const CONFIGURED_CARVERS_SCOPE: KoreScope = { builderName: 'configuredCarvers', receiverName: 'configuredCarversBuilder' };
export const DENSITY_FUNCTIONS_SCOPE: KoreScope = { builderName: 'densityFunctions', receiverName: 'densityFunctionsBuilder' };
export const TEST_ENVIRONMENTS_SCOPE: KoreScope = { builderName: 'testEnvironments', receiverName: 'testEnvironmentsBuilder' };

export const KORE_SCOPES: KoreScope[] = [
	RECIPES_SCOPE,
	DIALOGS_SCOPE,
	STRUCTURES_SCOPE,
	ENCHANTMENT_PROVIDERS_SCOPE,
	CONFIGURED_FEATURES_SCOPE,
	CONFIGURED_CARVERS_SCOPE,
	DENSITY_FUNCTIONS_SCOPE,
	TEST_ENVIRONMENTS_SCOPE,
];

// Tags override getPathFromDataDir to nest under tags/<type>/<file>.json: modeled here as a `tags/<type>` folder,
// one kind per typed `xxxTag` builder. The untyped `tag(fileName, type)` / `addToTag` are skipped (dynamic folder).
export const KORE_DECLARATION_KINDS: KoreDeclarationKind[] = [
	{ id: 'ADVANCEMENT', builderName: 'advancement', resourceFolder: 'advancement' },
	{ id: 'BANNER_PATTERN', builderName: 'bannerPattern', resourceFolder: 'banner_pattern' },
	{ id: 'BIOME', builderName: 'biome', resourceFolder: 'worldgen/biome' },
	{ id: 'CAT_SOUND_VARIANT', builderName: 'catSoundVariant', resourceFolder: 'cat_sound_variant' },
	{ id: 'CAT_VARIANT', builderName: 'catVariant', resourceFolder: 'cat_variant' },
	{ id: 'CHAT_TYPE', builderName: 'chatType', resourceFolder: 'chat_type' },
	{ id: 'CHICKEN_SOUND_VARIANT', builderName: 'chickenSoundVariant', resourceFolder: 'chicken_sound_variant' },
	{ id: 'CHICKEN_VARIANT', builderName: 'chickenVariant', resourceFolder: 'chicken_variant' },
	{ id: 'CONFIGURED_CARVER', builderName: 'configuredCarver', resourceFolder: 'worldgen/configured_carver' },
	{ id: 'CONFIGURED_FEATURE', builderName: 'configuredFeature', resourceFolder: 'worldgen/configured_feature' },
	{ id: 'COW_SOUND_VARIANT', builderName: 'cowSoundVariant', resourceFolder: 'cow_sound_variant' },
	{ id: 'COW_VARIANT', builderName: 'cowVariant', resourceFolder: 'cow_variant' },
	{ id: 'DAMAGE_TYPE', builderName: 'damageType', resourceFolder: 'damage_type' },
	{ id: 'DATA_PACK', builderName: 'dataPack' },
	{ id: 'DIMENSION', builderName: 'dimension', resourceFolder: 'dimension' },
	{ id: 'DIMENSION_TYPE', builderName: 'dimensionType', resourceFolder: 'dimension_type' },
	{ id: 'ENCHANTMENT', builderName: 'enchantment', resourceFolder: 'enchantment' },
	{ id: 'FLAT_LEVEL_GENERATOR_PRESET', builderName: 'flatLevelGeneratorPreset', resourceFolder: 'worldgen/flat_level_generator_preset' },
	{ id: 'FROG_VARIANT', builderName: 'frogVariant', resourceFolder: 'frog_variant' },
	{ id: 'FUNCTION', builderName: 'function', resourceFolder: 'function' },
	{ id: 'GENERATED_FUNCTION', builderName: 'generatedFunction', resourceFolder: 'function' },
	{ id: 'INSTRUMENT', builderName: 'instrument', resourceFolder: 'instrument' },
	{ id: 'ITEM_MODIFIER', builderName: 'itemModifier', resourceFolder: 'item_modifier' },
	{ id: 'JUKEBOX_SONG', builderName: 'jukeboxSong', resourceFolder: 'jukebox_song' },
	{ id: 'LOAD', builderName: 'load', resourceFolder: 'function' },
	{ id: 'LOOT_TABLE', builderName: 'lootTable', resourceFolder: 'loot_table' },
	{ id: 'NOISE', builderName: 'noise', resourceFolder: 'worldgen/noise' },
	{ id: 'NOISE_SETTINGS', builderName: 'noiseSettings', resourceFolder: 'worldgen/noise_settings' },
	{ id: 'PAINTING_VARIANT', builderName: 'paintingVariant', resourceFolder: 'painting_variant' },
	{ id: 'PIG_SOUND_VARIANT', builderName: 'pigSoundVariant', resourceFolder: 'pig_sound_variant' },
	{ id: 'PIG_VARIANT', builderName: 'pigVariant', resourceFolder: 'pig_variant' },
	{ id: 'PLACED_FEATURE', builderName: 'placedFeature', resourceFolder: 'worldgen/placed_feature' },
	{ id: 'PREDICATE', builderName: 'predicate', resourceFolder: 'predicate' },
	{ id: 'PROCESSOR_LIST', builderName: 'processorList', resourceFolder: 'worldgen/processor_list' },
	{ id: 'STRUCTURE', builderName: 'structure', resourceFolder: 'worldgen/structure' },
	{ id: 'STRUCTURE_SET', builderName: 'structureSet', resourceFolder: 'worldgen/structure_set' },
	{ id: 'SULFUR_CUBE_ARCHETYPE', builderName: 'sulfurCubeArchetype', resourceFolder: 'sulfur_cube_archetype' },
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
	{ id: 'WORLD_CLOCK', builderName: 'worldClock', resourceFolder: 'world_clock' },
	{ id: 'WORLD_PRESET', builderName: 'worldPreset', resourceFolder: 'worldgen/world_preset' },
	{ id: 'ZOMBIE_NAUTILUS_VARIANT', builderName: 'zombieNautilusVariant', resourceFolder: 'zombie_nautilus_variant' },

	// recipes { }
	{ id: 'BLASTING', builderName: 'blasting', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CAMPFIRE_COOKING', builderName: 'campfireCooking', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_DECORATED_POT', builderName: 'craftingDecoratedPot', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_DYE', builderName: 'craftingDye', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_IMBUE', builderName: 'craftingImbue', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SHAPED', builderName: 'craftingShaped', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SHAPELESS', builderName: 'craftingShapeless', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL', builderName: 'craftingSpecial', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_BANNER_DUPLICATE', builderName: 'craftingSpecialBannerDuplicate', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_BOOK_CLONING', builderName: 'craftingSpecialBookCloning', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_ROCKET', builderName: 'craftingSpecialFireworkRocket', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_STAR', builderName: 'craftingSpecialFireworkStar', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_FIREWORK_STAR_FADE', builderName: 'craftingSpecialFireworkStarFade', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_MAP_EXTENDING', builderName: 'craftingSpecialMapExtending', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_SPECIAL_SHIELD_DECORATION', builderName: 'craftingSpecialShieldDecoration', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'CRAFTING_TRANSMUTE', builderName: 'craftingTransmute', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'SMELTING', builderName: 'smelting', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'SMITHING_TRANSFORM', builderName: 'smithingTransform', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'SMITHING_TRIM', builderName: 'smithingTrim', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'SMOKING', builderName: 'smoking', resourceFolder: 'recipe', scope: RECIPES_SCOPE },
	{ id: 'STONE_CUTTING', builderName: 'stoneCutting', resourceFolder: 'recipe', scope: RECIPES_SCOPE },

	// dialogs { }
	{ id: 'CONFIRMATION', builderName: 'confirmation', resourceFolder: 'dialog', scope: DIALOGS_SCOPE },
	{ id: 'DIALOG_LIST', builderName: 'dialogList', resourceFolder: 'dialog', scope: DIALOGS_SCOPE },
	{ id: 'MULTI_ACTION', builderName: 'multiAction', resourceFolder: 'dialog', scope: DIALOGS_SCOPE },
	{ id: 'NOTICE', builderName: 'notice', resourceFolder: 'dialog', scope: DIALOGS_SCOPE },
	{ id: 'SERVER_LINKS', builderName: 'serverLinks', resourceFolder: 'dialog', scope: DIALOGS_SCOPE },

	// structures { }
	{ id: 'BURIED_TREASURE', builderName: 'buriedTreasure', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'DESERT_PYRAMID', builderName: 'desertPyramid', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'END_CITY', builderName: 'endCity', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'FORTRESS', builderName: 'fortress', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'IGLOO', builderName: 'igloo', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'JIGSAW', builderName: 'jigsaw', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'JUNGLE_TEMPLE', builderName: 'jungleTemple', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'MINESHAFT', builderName: 'mineshaft', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'NETHER_FOSSIL', builderName: 'netherFossil', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'OCEAN_MONUMENT', builderName: 'oceanMonument', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'OCEAN_RUIN', builderName: 'oceanRuin', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'RUINED_PORTAL', builderName: 'ruinedPortal', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'SHIPWRECK', builderName: 'shipwreck', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'STRONGHOLD', builderName: 'stronghold', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'SWAMP_HUT', builderName: 'swampHut', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },
	{ id: 'WOODLAND_MANSION', builderName: 'woodlandMansion', resourceFolder: 'worldgen/structure', scope: STRUCTURES_SCOPE },

	// enchantmentProviders { }
	{ id: 'BY_COST_ENCHANTMENT_PROVIDER', builderName: 'byCost', resourceFolder: 'enchantment_provider', scope: ENCHANTMENT_PROVIDERS_SCOPE },
	{ id: 'BY_COST_WITH_DIFFICULTY_ENCHANTMENT_PROVIDER', builderName: 'byCostWithDifficulty', resourceFolder: 'enchantment_provider', scope: ENCHANTMENT_PROVIDERS_SCOPE },
	{ id: 'SINGLE_ENCHANTMENT_PROVIDER', builderName: 'single', resourceFolder: 'enchantment_provider', scope: ENCHANTMENT_PROVIDERS_SCOPE },

	// configuredCarvers { }
	{ id: 'CANYON_CARVER', builderName: 'canyon', resourceFolder: 'worldgen/configured_carver', scope: CONFIGURED_CARVERS_SCOPE },
	{ id: 'CAVE_CARVER', builderName: 'cave', resourceFolder: 'worldgen/configured_carver', scope: CONFIGURED_CARVERS_SCOPE },
	{ id: 'NETHER_CAVE_CARVER', builderName: 'netherCave', resourceFolder: 'worldgen/configured_carver', scope: CONFIGURED_CARVERS_SCOPE },

	// configuredFeatures { }
	{ id: 'BAMBOO_FEATURE', builderName: 'bamboo', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BASALT_COLUMNS_FEATURE', builderName: 'basaltColumns', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BASALT_PILLAR_FEATURE', builderName: 'basaltPillar', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BLOCK_BLOB_FEATURE', builderName: 'blockBlob', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BLOCK_COLUMN_FEATURE', builderName: 'blockColumn', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BLOCK_PILE_FEATURE', builderName: 'blockPile', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BLUE_ICE_FEATURE', builderName: 'blueIce', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'BONUS_CHEST_FEATURE', builderName: 'bonusChest', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'CHORUS_PLANT_FEATURE', builderName: 'chorusPlant', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'CORAL_CLAW_FEATURE', builderName: 'coralClaw', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'CORAL_MUSHROOM_FEATURE', builderName: 'coralMushroom', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'CORAL_TREE_FEATURE', builderName: 'coralTree', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'DELTA_FEATURE', builderName: 'deltaFeature', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'DESERT_WELL_FEATURE', builderName: 'desertWell', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'DISK_FEATURE', builderName: 'disk', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'END_GATEWAY_FEATURE', builderName: 'endGateway', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'END_ISLAND_FEATURE', builderName: 'endIsland', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'END_PLATFORM_FEATURE', builderName: 'endPlatform', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'END_SPIKE_FEATURE', builderName: 'endSpike', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'FILL_LAYER_FEATURE', builderName: 'fillLayer', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'FOSSIL_FEATURE', builderName: 'fossil', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'FREEZE_TOP_LAYER_FEATURE', builderName: 'freezeTopLayer', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'GEODE_FEATURE', builderName: 'geode', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'GLOWSTONE_BLOB_FEATURE', builderName: 'glowstoneBlob', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'HUGE_BROWN_MUSHROOM_FEATURE', builderName: 'hugeBrownMushroom', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'HUGE_FUNGUS_FEATURE', builderName: 'hugeFungus', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'HUGE_RED_MUSHROOM_FEATURE', builderName: 'hugeRedMushroom', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'ICEBERG_FEATURE', builderName: 'iceberg', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'KELP_FEATURE', builderName: 'kelp', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'LAKE_FEATURE', builderName: 'lake', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'LARGE_DRIPSTONE_FEATURE', builderName: 'largeDripstone', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'MONSTER_ROOM_FEATURE', builderName: 'monsterRoom', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'MULTIFACE_GROWTH_FEATURE', builderName: 'multifaceGrowth', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'NETHER_FOREST_VEGETATION_FEATURE', builderName: 'netherForestVegetation', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'NETHERRACK_REPLACE_BLOBS_FEATURE', builderName: 'netherrackReplaceBlobs', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'NO_OP_FEATURE', builderName: 'noOp', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'ORE_FEATURE', builderName: 'ore', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'RANDOM_BOOLEAN_SELECTOR_FEATURE', builderName: 'randomBooleanSelector', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'RANDOM_PATCH_FEATURE', builderName: 'randomPatch', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'RANDOM_SELECTOR_FEATURE', builderName: 'randomSelector', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'REPLACE_SINGLE_BLOCK_FEATURE', builderName: 'replaceSingleBlock', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'ROOT_SYSTEM_FEATURE', builderName: 'rootSystem', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SCATTERED_ORE_FEATURE', builderName: 'scatteredOre', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SCULK_PATCH_FEATURE', builderName: 'sculkPatch', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SEAGRASS_FEATURE', builderName: 'seagrass', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SEA_PICKLE_FEATURE', builderName: 'seaPickle', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SEQUENCE_FEATURE', builderName: 'sequence', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SIMPLE_BLOCK_FEATURE', builderName: 'simpleBlock', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SIMPLE_RANDOM_SELECTOR_FEATURE', builderName: 'simpleRandomSelector', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SPELEOTHEM_FEATURE', builderName: 'speleothem', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SPELEOTHEM_CLUSTER_FEATURE', builderName: 'speleothemCluster', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SPIKE_FEATURE', builderName: 'spike', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'SPRING_FEATURE', builderName: 'springFeature', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'TEMPLATE_FEATURE', builderName: 'template', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'TREE_FEATURE', builderName: 'tree', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'TWISTING_VINES_FEATURE', builderName: 'twistingVines', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'UNDERWATER_MAGMA_FEATURE', builderName: 'underwaterMagma', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'VEGETATION_PATCH_FEATURE', builderName: 'vegetationPatch', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'VINES_FEATURE', builderName: 'vines', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'VOID_START_PLATFORM_FEATURE', builderName: 'voidStartPlatform', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'WATERLOGGED_VEGETATION_PATCH_FEATURE', builderName: 'waterloggedVegetationPatch', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'WEEPING_VINES_FEATURE', builderName: 'weepingVines', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },
	{ id: 'WEIGHTED_RANDOM_SELECTOR_FEATURE', builderName: 'weightedRandomSelector', resourceFolder: 'worldgen/configured_feature', scope: CONFIGURED_FEATURES_SCOPE },

	// densityFunctions { }
	{ id: 'ABS_DENSITY_FUNCTION', builderName: 'abs', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'ADD_DENSITY_FUNCTION', builderName: 'add', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'BEARDIFIER_DENSITY_FUNCTION', builderName: 'beardifier', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'BLEND_ALPHA_DENSITY_FUNCTION', builderName: 'blendAlpha', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'BLEND_DENSITY_DENSITY_FUNCTION', builderName: 'blendDensity', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'BLEND_OFFSET_DENSITY_FUNCTION', builderName: 'blendOffset', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'CACHE_ALL_IN_CELL_DENSITY_FUNCTION', builderName: 'cacheAllInCell', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'CACHE_ONCE_DENSITY_FUNCTION', builderName: 'cacheOnce', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'CLAMP_DENSITY_FUNCTION', builderName: 'clamp', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'CONSTANT_DENSITY_FUNCTION', builderName: 'constant', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'CUBE_DENSITY_FUNCTION', builderName: 'cube', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'END_ISLANDS_DENSITY_FUNCTION', builderName: 'endIslands', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'FIND_TOP_SURFACE_DENSITY_FUNCTION', builderName: 'findTopSurface', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'FLAT_CACHE_DENSITY_FUNCTION', builderName: 'flatCache', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'HALF_NEGATIVE_DENSITY_FUNCTION', builderName: 'halfNegative', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'INTERPOLATED_DENSITY_FUNCTION', builderName: 'interpolated', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'INTERVAL_SELECT_DENSITY_FUNCTION', builderName: 'intervalSelect', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'INVERT_DENSITY_FUNCTION', builderName: 'invert', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'MAX_DENSITY_FUNCTION', builderName: 'max', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'MIN_DENSITY_FUNCTION', builderName: 'min', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'MUL_DENSITY_FUNCTION', builderName: 'mul', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'NOISE_DENSITY_FUNCTION', builderName: 'noise', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'OLD_BLENDED_NOISE_DENSITY_FUNCTION', builderName: 'oldBlendedNoise', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'QUARTER_NEGATIVE_DENSITY_FUNCTION', builderName: 'quarterNegative', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'RANGE_CHOICE_DENSITY_FUNCTION', builderName: 'rangeChoice', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SHIFT_DENSITY_FUNCTION', builderName: 'shift', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SHIFT_A_DENSITY_FUNCTION', builderName: 'shiftA', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SHIFT_B_DENSITY_FUNCTION', builderName: 'shiftB', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SHIFTED_NOISE_DENSITY_FUNCTION', builderName: 'shiftedNoise', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SPLINE_DENSITY_FUNCTION', builderName: 'spline', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SQUARE_DENSITY_FUNCTION', builderName: 'square', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'SQUEEZE_DENSITY_FUNCTION', builderName: 'squeeze', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },
	{ id: 'Y_CLAMPED_GRADIENT_DENSITY_FUNCTION', builderName: 'yClampedGradient', resourceFolder: 'worldgen/density_function', scope: DENSITY_FUNCTIONS_SCOPE },

	// testEnvironments { }
	{ id: 'ALL_OF_TEST_ENVIRONMENT', builderName: 'allOf', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'CLOCK_TIME_TEST_ENVIRONMENT', builderName: 'clockTime', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'DIFFICULTY_TEST_ENVIRONMENT', builderName: 'difficulty', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'FUNCTION_TEST_ENVIRONMENT', builderName: 'function', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'GAME_RULES_TEST_ENVIRONMENT', builderName: 'gameRules', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'TIMELINE_ATTRIBUTES_TEST_ENVIRONMENT', builderName: 'timelineAttributes', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },
	{ id: 'WEATHER_TEST_ENVIRONMENT', builderName: 'weather', resourceFolder: 'test_environment', scope: TEST_ENVIRONMENTS_SCOPE },

	// tags
	{ id: 'BANNER_PATTERN_TAG', builderName: 'bannerPatternTag', resourceFolder: 'tags/banner_pattern' },
	{ id: 'BIOME_TAG', builderName: 'biomeTag', resourceFolder: 'tags/worldgen/biome' },
	{ id: 'BLOCK_TAG', builderName: 'blockTag', resourceFolder: 'tags/block' },
	{ id: 'CAT_VARIANT_TAG', builderName: 'catVariantTag', resourceFolder: 'tags/cat_variant' },
	{ id: 'CONFIGURED_CARVER_TAG', builderName: 'configuredCarverTag', resourceFolder: 'tags/worldgen/configured_carver' },
	{ id: 'CONFIGURED_FEATURE_TAG', builderName: 'configuredFeatureTag', resourceFolder: 'tags/worldgen/configured_feature' },
	{ id: 'CONFIGURED_STRUCTURE_TAG', builderName: 'configuredStructureTag', resourceFolder: 'tags/worldgen/structure' },
	{ id: 'DAMAGE_TYPE_TAG', builderName: 'damageTypeTag', resourceFolder: 'tags/damage_type' },
	{ id: 'ENCHANTMENT_TAG', builderName: 'enchantmentTag', resourceFolder: 'tags/enchantment' },
	{ id: 'ENTITY_TYPE_TAG', builderName: 'entityTypeTag', resourceFolder: 'tags/entity_type' },
	{ id: 'FLAT_LEVEL_GENERATOR_PRESET_TAG', builderName: 'flatLevelGeneratorPresetTag', resourceFolder: 'tags/worldgen/flat_level_generator_preset' },
	{ id: 'FLUID_TAG', builderName: 'fluidTag', resourceFolder: 'tags/fluid' },
	{ id: 'FROG_VARIANT_TAG', builderName: 'frogVariantTag', resourceFolder: 'tags/frog_variant' },
	{ id: 'FUNCTION_TAG', builderName: 'functionTag', resourceFolder: 'tags/function' },
	{ id: 'GAME_EVENT_TAG', builderName: 'gameEventTag', resourceFolder: 'tags/game_event' },
	{ id: 'INSTRUMENT_TAG', builderName: 'instrumentTag', resourceFolder: 'tags/instrument' },
	{ id: 'ITEM_TAG', builderName: 'itemTag', resourceFolder: 'tags/item' },
	{ id: 'NOISE_SETTINGS_TAG', builderName: 'noiseSettingsTag', resourceFolder: 'tags/worldgen/noise_settings' },
	{ id: 'NOISE_TAG', builderName: 'noiseTag', resourceFolder: 'tags/worldgen/noise' },
	{ id: 'PAINTING_VARIANT_TAG', builderName: 'paintingVariantTag', resourceFolder: 'tags/painting_variant' },
	{ id: 'PIG_VARIANT_TAG', builderName: 'pigVariantTag', resourceFolder: 'tags/pig_variant' },
	{ id: 'PLACED_FEATURE_TAG', builderName: 'placedFeatureTag', resourceFolder: 'tags/worldgen/placed_feature' },
	{ id: 'POINT_OF_INTEREST_TYPE_TAG', builderName: 'pointOfInterestTypeTag', resourceFolder: 'tags/point_of_interest_type' },
	{ id: 'PROCESSOR_LIST_TAG', builderName: 'processorListTag', resourceFolder: 'tags/worldgen/processor_list' },
	{ id: 'STRUCTURE_SET_TAG', builderName: 'structureSetTag', resourceFolder: 'tags/worldgen/structure_set' },
	{ id: 'STRUCTURE_TAG', builderName: 'structureTag', resourceFolder: 'tags/worldgen/structure' },
	{ id: 'TEMPLATE_POOL_TAG', builderName: 'templatePoolTag', resourceFolder: 'tags/worldgen/template_pool' },
	{ id: 'TIMELINE_TAG', builderName: 'timelineTag', resourceFolder: 'tags/timeline' },
	{ id: 'TRIM_MATERIAL_TAG', builderName: 'trimMaterialTag', resourceFolder: 'tags/trim_material' },
	{ id: 'TRIM_PATTERN_TAG', builderName: 'trimPatternTag', resourceFolder: 'tags/trim_pattern' },
	{ id: 'WOLF_VARIANT_TAG', builderName: 'wolfVariantTag', resourceFolder: 'tags/wolf_variant' },
	{ id: 'WORLD_PRESET_TAG', builderName: 'worldPresetTag', resourceFolder: 'tags/worldgen/world_preset' },
];

export const DATA_PACK_KIND = KORE_DECLARATION_KINDS.find(k => k.id === 'DATA_PACK')!;

const kindsByBuilderName = Map.groupBy(KORE_DECLARATION_KINDS, kind => kind.builderName);
const kindsById = new Map(KORE_DECLARATION_KINDS.map(kind => [kind.id, kind]));
const NO_SCOPES: ReadonlySet<KoreScope> = new Set();

/**
 * Resolves a callee to its kind. `noise` or `function` exist both as a top-level builder and inside a scope, so the
 * enclosing scopes decide: a scoped kind wins when its scope is active, otherwise the unscoped kind (if any).
 */
export function kindByBuilderName(builderName: string, activeScopes: ReadonlySet<KoreScope> = NO_SCOPES): KoreDeclarationKind | undefined {
	const candidates = kindsByBuilderName.get(builderName);
	if (!candidates) {
		return undefined;
	}
	return candidates.find(kind => kind.scope && activeScopes.has(kind.scope)) ?? candidates.find(kind => !kind.scope);
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
	directory?: string;
	kind: KoreDeclarationKind;
	name: string;
	namespace: string;
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

/** The `namespace:path` id used in-game and in other Kore calls, `#`-prefixed for tags. A datapack has none. */
export function resourceLocationFor({ kind, name, namespace, directory }: KoreElementPathParts): string | undefined {
	if (kind.id === 'DATA_PACK') {
		return undefined;
	}

	if (isFunctionKind(kind)) {
		return `${namespace}:${withTrailingSlash(directory ?? '')}${name}`;
	}

	return `${isTagKind(kind) ? '#' : ''}${namespace}:${name}`;
}

export function isTagKind(kind: KoreDeclarationKind): boolean {
	return kind.resourceFolder?.startsWith('tags/') ?? false;
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
	'tags/function': location => `/function ${location}`,
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
