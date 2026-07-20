import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceNodeModules = path.resolve(appDirectory, '../../node_modules');
const stagingDirectory = path.join(appDirectory, '.electron-runtime');
const runtimePackages = ['electron-updater', 'jose'];
const staged = new Set();

function packageDirectory(baseDirectory, packageName) {
  return path.join(baseDirectory, 'node_modules', ...packageName.split('/'));
}

function readPackage(packagePath) {
  return JSON.parse(readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
}

function resolveDependency(packagePath, dependencyName) {
  const nestedPath = packageDirectory(packagePath, dependencyName);
  if (existsSync(nestedPath)) return nestedPath;

  const hoistedPath = path.join(workspaceNodeModules, ...dependencyName.split('/'));
  return existsSync(hoistedPath) ? hoistedPath : null;
}

function stagePackage(packageName, sourcePath = null) {
  const packagePath = sourcePath ?? path.join(workspaceNodeModules, ...packageName.split('/'));
  const resolvedPath = realpathSync(packagePath);
  const destinationPath = path.join(stagingDirectory, ...packageName.split('/'));

  if (staged.has(packageName)) return;
  staged.add(packageName);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(resolvedPath, destinationPath, { recursive: true, dereference: true });

  const metadata = readPackage(resolvedPath);
  for (const dependencyName of Object.keys(metadata.dependencies ?? {})) {
    const dependencyPath = resolveDependency(resolvedPath, dependencyName);
    if (!dependencyPath) {
      throw new Error(`Missing required runtime dependency: ${packageName} -> ${dependencyName}`);
    }
    stagePackage(dependencyName, dependencyPath);
  }

  for (const dependencyName of Object.keys(metadata.optionalDependencies ?? {})) {
    const dependencyPath = resolveDependency(resolvedPath, dependencyName);
    if (dependencyPath) stagePackage(dependencyName, dependencyPath);
  }
}

rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(stagingDirectory, { recursive: true });
for (const packageName of runtimePackages) stagePackage(packageName);

console.log(`Staged ${staged.size} Electron runtime packages.`);
