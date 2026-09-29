import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(
  process.cwd(),
  'infra/postgres/migrations',
);
const files = (await readdir(directory))
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (!files.length) {
  throw new Error('No SQL migrations were found');
}

const seen = new Set();
for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    throw new Error(
      `Invalid migration filename "${file}". Expected NNN_snake_case.sql`,
    );
  }

  const number = Number.parseInt(match[1], 10);
  const expected = index + 1;
  if (number !== expected) {
    throw new Error(
      `Migration sequence gap/order error at "${file}": expected ${String(expected).padStart(3, '0')}`,
    );
  }
  if (seen.has(number)) {
    throw new Error(`Duplicate migration number: ${number}`);
  }
  seen.add(number);

  const body = (await readFile(path.join(directory, file), 'utf8')).trim();
  if (!body) {
    throw new Error(`Migration "${file}" is empty`);
  }
}

console.log(
  `Migration chain OK: ${files.length} file(s), 001–${String(files.length).padStart(3, '0')}`,
);
