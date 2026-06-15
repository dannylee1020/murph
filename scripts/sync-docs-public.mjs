import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const outputDir = join('docs', 'public');
const files = [
  ['install.sh', 'install.sh'],
  ['public/release.env'],
  ['public/slack-manifest.yaml'],
  ['public/slack-channel-manifest.yaml']
];

mkdirSync(outputDir, { recursive: true });

for (const [source, target = basename(source)] of files) {
  copyFileSync(source, join(outputDir, target));
}
