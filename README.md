# Kore Assistant

A Visual Studio Code extension providing powerful tools for working with [Kore](https://github.com/KryptonMC/Kore), a Kotlin library for creating Minecraft datapacks without writing JSON.

## Features

- **Gutter Icons**: Adds visual indicators in the editor gutter next to `dataPack` and `function` declarations in Kotlin files
- **Hover Information**: Shows the name of datapacks and functions when hovering over the gutter icons

## Current State

This extension is in early development and currently provides:

- Visual indicators for Kore's `dataPack("name") { ... }` declarations
- Visual indicators for Kore's `function("name") { ... }` declarations
- Hover tooltip showing the datapack/function name

## Planned Features

- Explorer view with a list of all datapacks and functions in your workspace
- Quick navigation to datapacks and functions
- Commands for common Kore operations

## Requirements

- Visual Studio Code 1.98.0 or newer
- Kotlin Language Support

## Usage

Just open a Kotlin file containing Kore's datapack and function declarations. The extension will automatically highlight them with gutter icons.

To refresh the icons manually, run the "Kore: Refresh Gutter Icons" command from the command palette.

## Feedback & Issues

Please file issues and feature requests on the project's repository.

## License

MIT
