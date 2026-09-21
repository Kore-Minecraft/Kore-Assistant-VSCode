import { defineConfig } from 'tsdown';

// `--minify` (package) and `--sourcemap` (dev/watch) are passed from package.json scripts, everything else lives here.
export default defineConfig({
	entry: 'src/extension.ts',
	format: 'cjs',
	platform: 'node',
	target: 'node22',
	outDir: 'dist',
	deps: { neverBundle: ['vscode'] },
	copy: 'src/assets',
	dts: false,
});
