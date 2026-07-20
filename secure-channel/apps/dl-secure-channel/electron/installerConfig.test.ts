import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('Ridgeline installer configuration', () => {
  it('preserves the updater identity and uses assisted per-user NSIS', () => {
    expect(packageJson.build.appId).toBe('com.darklock.ridgeline');
    expect(packageJson.build.artifactName).toBe('Ridgeline-${version}-${os}-${arch}.${ext}');
    expect(packageJson.build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      allowElevation: true,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      unicode: true,
    });
  });

  it('ships local branded NSIS resources and the narrow installer include', () => {
    for (const name of [
      'installerIcon.ico',
      'uninstallerIcon.ico',
      'installerHeader.bmp',
      'installerSidebar.bmp',
      'uninstallerSidebar.bmp',
      'installer.nsh',
    ]) {
      const resource = new URL(`../public/installer/${name}`, import.meta.url);
      expect(existsSync(resource)).toBe(true);
      expect(statSync(resource).size).toBeGreaterThan(256);
    }
    expect(packageJson.build.nsis.include).toBe('installer/installer.nsh');
  });
});
