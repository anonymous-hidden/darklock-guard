'use strict';

const crypto = require('crypto');

class UserPrivacy {
    constructor() {
        const secret = process.env.USER_DATA_ENCRYPTION_KEY
            || process.env.ACCOUNT_ENCRYPTION_KEY
            || process.env.AUDIT_ENCRYPTION_KEY
            || process.env.JWT_SECRET
            || process.env.DISCORD_TOKEN
            || 'darklock-local-user-privacy-key';

        this.key = crypto.createHash('sha256').update(String(secret)).digest();
        this.version = 1;
    }

    normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    hash(value) {
        const normalized = this.normalize(value);
        if (!normalized) return null;
        return crypto.createHmac('sha256', this.key).update(normalized).digest('hex');
    }

    encrypt(value) {
        if (value === undefined || value === null || value === '') return null;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(String(value), 'utf8'),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        return [
            `v${this.version}`,
            iv.toString('base64'),
            tag.toString('base64'),
            ciphertext.toString('base64')
        ].join(':');
    }

    decrypt(blob) {
        if (!blob || typeof blob !== 'string') return null;
        const [version, ivB64, tagB64, dataB64] = blob.split(':');
        if (version !== `v${this.version}` || !ivB64 || !tagB64 || !dataB64) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(dataB64, 'base64')),
            decipher.final()
        ]);
        return plaintext.toString('utf8');
    }

    pseudonym(userId) {
        const id = String(userId || 'unknown');
        return `discord-user-${id.slice(-6)}`;
    }

    protectUserRecord(userData = {}, userId = null) {
        const out = { ...userData };

        if (Object.prototype.hasOwnProperty.call(userData, 'username')) {
            out.username_encrypted = this.encrypt(userData.username);
            out.username_hash = this.hash(userData.username);
            out.username = this.pseudonym(userId);
        }

        if (Object.prototype.hasOwnProperty.call(userData, 'display_name')) {
            out.display_name_encrypted = this.encrypt(userData.display_name);
            out.display_name_hash = this.hash(userData.display_name);
            out.display_name = this.pseudonym(userId);
        }

        if (Object.prototype.hasOwnProperty.call(userData, 'discriminator')) {
            out.discriminator_encrypted = this.encrypt(userData.discriminator);
            out.discriminator = null;
        }

        if (Object.prototype.hasOwnProperty.call(userData, 'account_metadata')) {
            out.account_metadata_encrypted = this.encrypt(JSON.stringify(userData.account_metadata || {}));
            delete out.account_metadata;
        }

        out.privacy_version = this.version;
        return out;
    }
}

module.exports = UserPrivacy;