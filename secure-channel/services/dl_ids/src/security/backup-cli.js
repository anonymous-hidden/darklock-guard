#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  createEncryptedBackup,
  restoreEncryptedBackup,
  verifyEncryptedBackup,
} from './backup-archive.js';
import { createIdsSecureFields } from './secure-fields.js';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function argumentAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const command = process.argv[2];
  const secureFields = await createIdsSecureFields({
    ...process.env,
    RIDGELINE_SECURE_STORAGE_MODE: 'private-beta',
  });
  try {
    if (command === 'create') {
      const databasePath = argumentAfter('--database');
      const backupDirectory = argumentAfter('--output');
      const retain = Number(argumentAfter('--retain') || 7);
      if (!databasePath || !backupDirectory || !existsSync(databasePath)) fail('RIDGELINE_BACKUP_ARGUMENTS_INVALID');
      const result = await createEncryptedBackup({ databasePath, backupDirectory, secureFields, retain });
      const stateDb = new Database(resolve(databasePath), { fileMustExist: true });
      try {
        stateDb.exec(`
          CREATE TABLE IF NOT EXISTS secure_storage_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        stateDb.prepare(`
          INSERT INTO secure_storage_state (key, value, updated_at)
          VALUES ('encrypted_backup_verified', ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        `).run(secureFields.keyFingerprint);
      } finally {
        stateDb.close();
      }
      process.stdout.write(`Encrypted Ridgeline backup created and verified: ${result.archivePath}\n`);
      return;
    }
    if (command === 'verify') {
      const archivePath = argumentAfter('--archive');
      if (!archivePath || !existsSync(archivePath)) fail('RIDGELINE_BACKUP_ARCHIVE_NOT_FOUND');
      await verifyEncryptedBackup({ archivePath, secureFields });
      process.stdout.write('Encrypted Ridgeline backup verified successfully.\n');
      return;
    }
    if (command === 'restore') {
      const archivePath = argumentAfter('--archive');
      const destinationPath = argumentAfter('--destination');
      if (!process.argv.includes('--confirm-restore')) fail('RIDGELINE_RESTORE_EXPLICIT_CONFIRMATION_REQUIRED');
      if (!archivePath || !destinationPath || !existsSync(archivePath)) fail('RIDGELINE_RESTORE_ARGUMENTS_INVALID');
      const result = await restoreEncryptedBackup({
        archivePath: resolve(archivePath),
        destinationPath: resolve(destinationPath),
        secureFields,
      });
      process.stdout.write(`Ridgeline backup restored and integrity checked: ${result.destinationPath}\n`);
      return;
    }
    fail('RIDGELINE_BACKUP_COMMAND_INVALID');
  } finally {
    secureFields.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.code || 'RIDGELINE_BACKUP_COMMAND_FAILED'}\n`);
  process.exitCode = 1;
});
