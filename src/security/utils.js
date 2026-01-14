const fs = require('fs').promises;
const path = require('path');

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
}

async function writeJson(filePath, obj) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

async function readJson(filePath) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

module.exports = { ensureDir, writeJson, readJson };
