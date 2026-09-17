import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDirectory = join(process.cwd(), 'dist');

async function updateJavaScriptImports(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      await updateJavaScriptImports(entryPath);
      continue;
    }

    if (!entry.name.endsWith('.js')) {
      continue;
    }

    const source = await readFile(entryPath, 'utf8');
    const fixed = source.replace(
      /(from\s+['"]\.?\.?\/[^'"]+|import\s*\(\s*['"]\.?\.?\/[^'"]+)/g,
      (specifier) => specifier.endsWith('.js') ? specifier : `${specifier}.js`,
    );

    if (fixed !== source) {
      await writeFile(entryPath, fixed);
    }
  }
}

await updateJavaScriptImports(distDirectory);