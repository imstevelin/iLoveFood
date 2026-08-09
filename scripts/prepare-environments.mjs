import { access, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environmentsDir = path.join(projectRoot, 'src', 'environments');
const environmentFiles = [
  ['environment.example.ts', 'environment.ts'],
  ['environment.prod.example.ts', 'environment.prod.ts']
];

for (const [exampleName, targetName] of environmentFiles) {
  const source = path.join(environmentsDir, exampleName);
  const target = path.join(environmentsDir, targetName);

  try {
    await access(target, constants.F_OK);
  } catch {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    console.log(`Created ${path.relative(projectRoot, target)} from its safe example.`);
  }
}
