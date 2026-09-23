import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(frontend, '..');
const python = resolve(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('Python environment is missing. Run uv sync --locked in the project root first.');
  process.exit(1);
}
const result = spawnSync(python, [
  '-m', 'money_graph', '--data', resolve(project, 'data'),
  '--out', resolve(frontend, 'public/generated'),
], { cwd: project, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
