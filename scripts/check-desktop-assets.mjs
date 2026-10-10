import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Vite copies public resources verbatim. Desktop does not distribute the
// independently licensed website font kit or browser update pages.
for (const path of ['fonts/novecento', 'sw.js', 'manifest.webmanifest', 'update.html']) {
  rmSync(join('dist-desktop', path), { recursive: true, force: true });
}
for (const path of ['index.html', 'assets', 'fonts/NOTICE.txt', 'licenses/rhine-lab.txt']) {
  if (!existsSync(join('dist-desktop', path))) throw new Error(`Missing desktop resource: ${path}`);
}
if (!readdirSync('dist-desktop/assets').some(name => name.startsWith('metadata-worker'))) {
  throw new Error('Metadata Worker missing from desktop build');
}
