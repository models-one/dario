import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../src/cc-template-data.json', import.meta.url), new URL('../dist/cc-template-data.json', import.meta.url));
