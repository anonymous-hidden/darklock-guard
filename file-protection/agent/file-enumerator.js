const fs = require('fs');
const path = require('path');
const { TIER_SOURCES } = require('./constants');

class FileEnumerator {
    constructor(logger = console) {
        this.logger = logger;
    }

    normalize(p) {
        return path.normalize(p);
    }

    /**
     * Recursively or shallowly gather files from a target path.
     * @param {Object} entry
     * @param {string} entry.path
     * @param {boolean} entry.recurse
     * @param {string[]} entry.extensions
     * @returns {string[]}
     */
    collectFromEntry(entry) {
        const targetPath = this.normalize(entry.path);
        const recurse = entry.recurse === true;
        const allowedExts = entry.extensions || ['.js', '.json'];

        if (!fs.existsSync(targetPath)) {
            this.logger.warn(`[Enumerator] Skipping missing path: ${targetPath}`);
            return [];
        }

        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
            const ext = path.extname(targetPath);
            if (allowedExts.includes(ext) || allowedExts.length === 0) {
                return [targetPath];
            }
            return [];
        }

        if (!stat.isDirectory()) {
            return [];
        }

        const files = [];
        const entries = fs.readdirSync(targetPath);

        for (const item of entries) {
            const fullPath = path.join(targetPath, item);
            const itemStat = fs.statSync(fullPath);

            if (itemStat.isDirectory()) {
                if (recurse) {
                    files.push(...this.collectFromEntry({ path: fullPath, recurse, extensions: allowedExts }));
                }
                continue;
            }

            if (itemStat.isFile()) {
                const ext = path.extname(fullPath);
                if (allowedExts.includes(ext) || allowedExts.length === 0) {
                    files.push(this.normalize(fullPath));
                }
            }
        }

        return files;
    }

    /**
     * Build a map of protected files keyed by absolute path with tier metadata.
     * @returns {{files: Array<{path: string, tier: string}>, map: Object<string, string>}}
     */
    buildProtectedMap() {
        const tierPriority = ['critical', 'high', 'medium'];
        const protectedFiles = [];
        const tierMap = {};

        for (const tier of tierPriority) {
            const entries = TIER_SOURCES[tier] || [];
            for (const entry of entries) {
                const files = this.collectFromEntry(entry);
                for (const filePath of files) {
                    const normalized = this.normalize(filePath);
                    // Highest severity wins if duplicates
                    if (!tierMap[normalized]) {
                        tierMap[normalized] = tier;
                        protectedFiles.push({ path: normalized, tier });
                    }
                }
            }
        }

        return { files: protectedFiles, map: tierMap };
    }
}

module.exports = FileEnumerator;
