# Change Log

All notable changes to the "Kore Assistant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- Context menu on every Explorer node: copy the name, namespace, resource location, output path, command, file path or `file:line` declaration path of a declaration, the `pack.mcmeta` path and source of a datapack, the output folder of a category or path group, and the path of a file
- "Go to Declaration" on datapack roots and file nodes, which have no click action
- Names, namespaces, directories and datapack names given as a `val` constant (`dataPack(NAMESPACE)`, `Constants.NAMESPACE`), a string template (`"blocks/$leafId"`) or a concatenation (`"blocks/" + LEAF + "_log"`) resolve through the workspace's `val` bindings, following `val A = B` and template chains up to 8 hops, the closest in-scope local first, then the file-level one, then a workspace-wide unique one
- Declarations inside a datapack helper (`fun DataPack.xxx()`, `fun xxx(dp: DataPack)` or `context(dp: DataPack) fun xxx()`) belong to the datapack whose `dataPack { }` block calls the helper, following calls through other helpers and across files; a same-file function of the same name shadows the lookup like in Kotlin
- Helpers no datapack calls fall back to the datapack declared in the closest folder, which keeps each project of a multi-project workspace (the Kore `Examples` repo) under its own pack
- Duplicate declaration warning: two declarations of one datapack writing the same output file are flagged on both sides, with links to each other, since the last one generated silently overwrites the others
- Unresolved function command error: a `function("helper")` command inside a function body whose target is declared nowhere in the project, with quick fixes to rename it to a close match, call it under the namespace that declares it, swap inverted `namespace, name` arguments, or create the missing function after the caller
- `craftingShaped` checks: at most 3 rows of at most 3 characters, every row as wide as the first, no empty row, every pattern character mapped by a `key` / `keys` entry, single-character non-space keys, and unused keys greyed out
- `kore-assistant.diagnostics.enabled` setting to turn the checks off
- Kore project detection from `build.gradle(.kts)`, `pom.xml` and `libs.versions.toml` (Kore version, Gradle plugin applied), logged in the output channel
- Explorer groupings: "Output Structure" (datapack > namespace > resource folder > path folders, the generated layout, where the 20 recipe kinds collapse into one `recipe` folder) and "Flat List", next to the existing kind and source file views
- A function's `directory` argument (`function("on_death", directory = "hearts")`) is a folder in the explorer, and the full `hearts/on_death` path shows in the file and flat views
- The gutter hover ends with a "Reveal in Kore Explorer" link, and the gutter/line-number right-click menu offers the same for the clicked line
- The `function` command is recognized under an import alias (`import io.github.ayfri.kore.commands.function as callFunction`)
- Explorer sorting by name, kind, namespace or declaration order; picking the active criterion again flips the direction
- Explorer filter matching the name, namespace or output path of every declaration, with the match count shown above the tree and on the view badge
- Element counts on datapack, namespace, folder, category, path group and file rows, a `~` marker on declarations whose name is built at runtime, and a hover on every container row listing its output folder, elements, namespaces, kinds, folders or files
- "Copy All Resource Locations" and "Copy All Output Paths" on container rows, one value per line
- "Kore: Reveal in Kore Explorer" in the Kotlin editor context menu, selecting the declaration under the cursor in the tree
- Refresh button rescanning the workspace, and a file watcher picking up Kotlin files changed outside VS Code (git checkout, generated sources)
- Grouping and sorting choices are remembered per workspace, and collapsed rows stay collapsed across refreshes

### Changed
- Grouping and sorting are picked from two quick picks instead of toggle buttons
- Declarations grouped by file or listed flat show their full name rather than the last path segment
- Explorer tooltips are Markdown, with every value rendered as code, and match the editor hover
- Copy entries are direct menu items instead of the "Copy..." picker
- A trailing comment after a name argument or a `namespace = "..."` statement no longer makes the value dynamic

### Removed
- The "Kore: Test Extension" placeholder command

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
