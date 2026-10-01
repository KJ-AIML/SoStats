import { readdir } from 'node:fs/promises';
import path from 'node:path';

const appRoot = path.resolve(process.cwd(), 'apps/web/src/app');

function isDynamicSegment(name) {
  return /^\[.*\]$/.test(name);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const dynamicDirectories = entries
    .filter((entry) => entry.isDirectory() && isDynamicSegment(entry.name))
    .map((entry) => entry.name);

  if (new Set(dynamicDirectories).size > 1) {
    const location = path.relative(process.cwd(), directory) || '.';
    throw new Error(
      `Conflicting dynamic route segment names under ${location}: ${dynamicDirectories.join(', ')}. ` +
        'Next.js requires one slug name for a dynamic segment at the same route position.',
    );
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => walk(path.join(directory, entry.name))),
  );
}

await walk(appRoot);
console.log('Next.js route segment check passed.');
