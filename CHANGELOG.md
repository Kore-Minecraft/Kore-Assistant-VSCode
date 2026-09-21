# Change Log

All notable changes to the "Kore Assistant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- Context menu on every Explorer node: copy the name, namespace, resource location, output path, command, file path or `file:line` declaration path of a declaration, the `pack.mcmeta` path and source of a datapack, the output folder of a category or path group, and the path of a file
- "Go to Declaration" on datapack roots and file nodes, which have no click action

### Changed
- Explorer tooltips are Markdown, with every value rendered as code, and match the editor hover
- Copy entries are direct menu items instead of the "Copy..." picker

## [0.3.0] - 2026-09-21

### Added
- Tags: every typed tag builder (`blockTag`, `itemTag`, `functionTag`, `biomeTag`, ...) is discovered, with its `tags/<type>/` output path and `#namespace:name` location
- Scoped builders: recipes, dialogs, structures, enchantment providers, configured features, carvers, density functions and test environments are detected inside their `recipes { }` / `structures { }` / ... block or through the `xxxBuilder.` property, with or without a trailing lambda
- The 63 configured feature builders (`ore`, `tree`, `geode`, `speleothem`, ...), the 3 carvers and the 32 density function builders of Kore 26.2
- `sulfurCubeArchetype`, `structure` and the `testEnvironments { }` builders

### Changed
- Builder names follow Kore 2.14.0-26.2: `shipwreck`, and `single` / `byCost` / `byCostWithDifficulty` inside `enchantmentProviders { }`, which now write to `enchantment_provider/`
- Explorer categories are ordered by resource folder, so related kinds (all recipes, all features) sit next to each other
- A Kotlin function declaration named like a builder (`fun DataPack.tick(name: String) { }`) is no longer reported as a declaration
- Faster workspace scan: Kotlin files are read from disk in parallel and the Explorer refreshes once, not once per file
- Generated Kotlin under `build/`, `.gradle/`, `.idea/` and `node_modules/` is no longer scanned
- Deleting or renaming a Kotlin file now removes its elements from the Explorer

### Removed
- `densityFunction`, `shipWreck` and the `*EnchantmentProvider` builders, which no longer exist in Kore

## [0.2.0] - 2026-07-27

### Added
- Discover Kore resources beyond datapacks and functions, including predicates, recipes, advancements, dialogs, and world-generation resources
- See each resource's location, generated file, and relevant command when hovering over it in Kotlin files
- Browse resources by datapack and type in the Kore Explorer, with support for nested paths
- Copy a resource's name, location, generated file, or command from the Explorer

### Changed
- Improved Kore Explorer navigation, sorting, and grouping
- Added clearer icons and richer hover details for generated JSON resources

## [0.1.0] - 2024-03-24

### Added
- Initial release of Kore Assistant
- Gutter icons for dataPack and function declarations
- Hover information for Kore elements
- Explorer view in sidebar for browsing Kore elements
- Navigation to dataPack and function declarations
- Sorting and grouping options (by file or by type)
- Snippets for creating Kore elements
