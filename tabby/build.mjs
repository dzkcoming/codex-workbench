import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cp } from 'node:fs/promises';
const root = dirname(fileURLToPath(import.meta.url));
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: true, logLevel: 'info' };
await build({ ...common, entryPoints: [join(root, 'src/index.ts')], outfile: join(root, 'dist/index.cjs'),
  tsconfig: join(root, 'tsconfig.json'), external: ['@angular/*', 'tabby-*', 'electron', '@electron/remote', 'rxjs'], keepNames: true });
await build({ ...common, entryPoints: [join(root, 'src/browser-host.ts')], outfile: join(root, 'dist/browser-host.cjs'), external: ['electron'] });
await cp(join(root, 'licenses'), join(root, 'dist/licenses'), { recursive: true });
await Promise.all(['worker', 'mcp'].map(name => build({ ...common, entryPoints: [join(root, `src/${name}.ts`)], outfile: join(root, `dist/${name}.cjs`) })));
await build({ ...common, entryPoints: [join(root, 'examples/source-label/index.ts')],
  outfile: join(root, 'examples/source-label/dist/index.cjs'), tsconfig: join(root, 'tsconfig.json'),
  external: ['@angular/*', 'tabby-*'], keepNames: true });
