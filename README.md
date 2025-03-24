# Kore Assistant

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=ayfri.kore-assistant)

A Visual Studio Code extension providing powerful tools for working with [Kore](https://github.com/Ayfri/Kore), a Kotlin library for creating Minecraft datapacks without writing JSON.

## Features

- **Gutter Icons**: Adds visual indicators in the editor gutter next to `dataPack` and `function` declarations in Kotlin files
- **Hover Information**: Shows the name of datapacks and functions when hovering over the gutter icons
- **Explorer View**: Provides a dedicated explorer view to browse all datapacks and functions in your workspace
- **Navigation**: Quickly jump to datapack and function declarations through the explorer
- **Sorting and Grouping**: Organize your Kore elements by file or by type
- **Commands**: Run common Kore operations directly from VS Code
- **Snippets**: Code snippets for quickly creating Kore elements with proper imports

## Installation

You can install this extension through the VS Code Marketplace:

1. Open VS Code
2. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS)
3. Search for "Kore Assistant"
4. Click Install

Alternatively, you can install it directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ayfri.kore-assistant).

## About Kore

[Kore](https://github.com/Ayfri/Kore) is a modern Kotlin library that allows you to:

- Create Minecraft datapacks using Kotlin instead of JSON
- Write clean, type-safe code with full IDE support
- Generate commands, recipes, advancements and other datapack components
- Support for Minecraft 1.20 and later versions

Visit [kore.ayfri.com](https://kore.ayfri.com/) for official documentation.

## Requirements

- Visual Studio Code 1.98.0 or newer
- Kotlin Language Support

## Usage

1. Open a Kotlin file containing Kore's datapack and function declarations
2. The extension will automatically detect and highlight them with gutter icons
3. Use the Kore Explorer in the sidebar to browse and navigate your Kore elements
4. Configure display preferences using the view toolbar buttons
5. Use the snippets to quickly create new Kore elements (see snippets section below)

To refresh the icons manually, run the "Kore: Refresh Gutter Icons" command from the command palette.

## Snippets

The extension provides the following snippets for Kotlin files:

- `dp` - Creates a datapack declaration with automatic import
- `fn` - Creates a function declaration with automatic import

## Extension Settings

- Group elements by file or type
- Sort elements by name or file location

## Feedback & Issues

Please file issues and feature requests on the [project's repository](https://github.com/Kore-Minecraft/Kore-Assistant-VSCode/issues).

## License

This extension is licensed under the [GNU General Public License v3.0](LICENSE).
