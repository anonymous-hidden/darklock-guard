const crypto = require('crypto');
const fs = require('fs');

/**
 * SHA-256 File Hasher
 * Generates cryptographic hashes for tamper detection
 */
class Hasher {
    /**
     * Hash a file using SHA-256
     * @param {string} filePath - Absolute path to file
     * @returns {string} SHA-256 hash in hex format
     */
    static hashFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Read raw bytes to avoid encoding issues
            const fileBuffer = fs.readFileSync(filePath);
            const hash = crypto.createHash('sha256');
            hash.update(fileBuffer);
            
            return hash.digest('hex');
        } catch (error) {
            throw new Error(`Failed to hash file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Hash multiple files
     * @param {string[]} filePaths - Array of file paths
     * @returns {Object} Map of filepath -> hash
     */
    static hashFiles(filePaths) {
        const hashes = {};
        
        for (const filePath of filePaths) {
            try {
                hashes[filePath] = this.hashFile(filePath);
            } catch (error) {
                console.error(`[Hasher] Error hashing ${filePath}:`, error.message);
                hashes[filePath] = null;
            }
        }
        
        return hashes;
    }

    /**
     * Verify file matches expected hash
     * @param {string} filePath - File to verify
     * @param {string} expectedHash - Expected SHA-256 hash
     * @returns {boolean} True if hash matches
     */
    static verify(filePath, expectedHash) {
        try {
            const currentHash = this.hashFile(filePath);
            return currentHash === expectedHash;
        } catch (error) {
            console.error(`[Hasher] Verification failed:`, error.message);
            return false;
        }
    }
}

module.exports = Hasher;
