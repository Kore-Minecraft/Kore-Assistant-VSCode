# Change Log

All notable changes to the "Kore Assistant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.0] - 2026-09-21

### Added

**Explorer**
- Four groupings: Output Structure (datapack > namespace > resource folder > path folders, the generated layout), Kind (datapack > kind > path folders), Source File and Flat List
- Sorting by name, kind, namespace or declaration order, in either direction (pick the active criterion again to flip it)
- Filter on name, namespace or output path, with the match count above the tree and on the view badge
- Element counts on every container row, a `~` marker on names built at runtime, and a hover on every container row listing its output folder, elements, namespaces, kinds, folders and files
- Context menu on every row: copy the name, namespace, resource location, output path, command, file path or `file:line` declaration path; container rows also copy every resource location or output path underneath, one per line; "Go to Declaration" on datapack and file rows
- "Reveal in Kore Explorer" from the editor context menu, the gutter right-click menu and a link in the gutter hover
- Refresh button, and a file watcher picking up Kotlin files changed outside VS Code (git checkout, generated sources)
- Grouping and sorting are remembered per workspace, collapsed rows stay collapsed across refreshes
- A function's `directory` argument is a folder in the tree, like on disk

**Resolution**
- Names, namespaces, directories and datapack names given as a `val` constant, a string template or a concatenation resolve through the workspace's `val` bindings (`val A = B` chains up to 8 hops, closest scope first)
- Declarations inside a helper (`fun DataPack.xxx()`, `fun xxx(dp: DataPack)`, `context(dp: DataPack) fun xxx()`) belong to the datapack whose block calls it, across helpers and files; uncalled helpers fall back to the datapack declared in the closest folder
- The `function` command is recognized under an import alias (`import ...commands.function as callFunction`)

**Diagnostics** (`kore-assistant.diagnostics.enabled` turns them off)
- Duplicate declarations writing the same output file, flagged on both sides with links to each other
- Unresolved `function("helper")` commands, with quick fixes: rename to a close match, use the declaring namespace, swap inverted `namespace, name` arguments, or create the missing function
- `craftingShaped` grids: size, row width, empty rows, unmapped pattern characters, invalid keys, unused keys greyed out

**Project**
- Kore project detection from `build.gradle(.kts)`, `pom.xml` and `libs.versions.toml` (Kore version, Gradle plugin applied), logged in the output channel

### Changed
- Grouping and sorting are picked from two quick picks instead of toggle buttons; copy entries are direct menu items instead of the "Copy..." picker
- Explorer tooltips are Markdown, with values rendered as code, and match the editor hover
- The element hover is titled by the resource location, shows the datapack and output path on one row and the file as a link to the declaration, with the command set apart under a rule; the output path and the command each carry a copy icon, and the links keep the explorer hover open while the mouse is inside it
- Declarations grouped by file or listed flat show their full path rather than the last segment
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
