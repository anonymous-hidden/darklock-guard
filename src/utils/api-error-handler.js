/**
 * Standardized API Error Handling for Dashboard
 * Ensures consistent error responses across all endpoints
 */

class APIErrorHandler {
    /**
     * Standard error response format
     */
    static formatError(error, defaultMessage = 'An error occurred') {
        return {
            success: false,
            data: null,
            error: error?.message || error || defaultMessage,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Handle async route with automatic error catching
     */
    static asyncHandler(fn) {
        return async (req, res, next) => {
            try {
                await fn(req, res, next);
            } catch (error) {
                console.error('[API Error]', error);
                
                // Determine appropriate status code
                let statusCode = 500;
                if (error.name === 'ValidationError') statusCode = 400;
                if (error.message?.includes('not found')) statusCode = 404;
                if (error.message?.includes('unauthorized') || error.message?.includes('forbidden')) statusCode = 403;
                if (error.message?.includes('rate limit')) statusCode = 429;
                
                res.status(statusCode).json(this.formatError(error));
            }
        };
    }

    /**
     * Validate required parameters
     */
    static validateRequired(params, requiredFields) {
        const missing = [];
        for (const field of requiredFields) {
            if (params[field] === undefined || params[field] === null || params[field] === '') {
                missing.push(field);
            }
        }
        
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
    }

    /**
     * Validate guild ID format
     */
    static validateGuildId(guildId) {
        if (!guildId || !/^\d{17,19}$/.test(guildId)) {
            throw new Error('Invalid guild ID format');
        }
        return guildId;
    }

    /**
     * Validate user ID format
     */
    static validateUserId(userId) {
        if (!userId || !/^\d{17,19}$/.test(userId)) {
            throw new Error('Invalid user ID format');
        }
        return userId;
    }

    /**
     * Sanitize string input
     */
    static sanitizeString(input, maxLength = 2000) {
        if (!input) return '';
        
        let sanitized = String(input)
            .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
            .trim();
        
        if (sanitized.length > maxLength) {
            sanitized = sanitized.substring(0, maxLength);
        }
        
        return sanitized;
    }

    /**
     * Validate and sanitize array
     */
    static sanitizeArray(input, maxLength = 100, itemValidator = null) {
        if (!Array.isArray(input)) return [];
        
        let sanitized = input.slice(0, maxLength);
        
        if (itemValidator && typeof itemValidator === 'function') {
            sanitized = sanitized.filter(itemValidator);
        }
        
        return sanitized;
    }

    /**
     * Rate limit check helper
     */
    static checkRateLimit(cache, key, maxRequests = 60, windowMs = 60000) {
        const now = Date.now();
        const record = cache.get(key) || { count: 0, resetTime: now + windowMs };
        
        if (now > record.resetTime) {
            // Reset window
            cache.set(key, { count: 1, resetTime: now + windowMs });
            return { allowed: true, remaining: maxRequests - 1 };
        }
        
        if (record.count >= maxRequests) {
            return { 
                allowed: false, 
                remaining: 0,
                resetIn: Math.ceil((record.resetTime - now) / 1000)
            };
        }
        
        record.count++;
        cache.set(key, record);
        
        return { allowed: true, remaining: maxRequests - record.count };
    }

    /**
     * Create success response
     */
    static success(data = null, message = null) {
        const response = {
            success: true,
            data,
            error: null,
            timestamp: new Date().toISOString()
        };
        
        if (message) {
            response.message = message;
        }
        
        return response;
    }

    /**
     * Handle database errors specifically
     */
    static handleDatabaseError(error) {
        console.error('[Database Error]', error);
        
        if (error.message?.includes('UNIQUE constraint')) {
            return this.formatError({ message: 'Duplicate entry - record already exists' });
        }
        
        if (error.message?.includes('NOT NULL constraint')) {
            return this.formatError({ message: 'Missing required database field' });
        }
        
        if (error.message?.includes('no such table')) {
            return this.formatError({ message: 'Database schema error - table not found' });
        }
        
        return this.formatError(error, 'Database operation failed');
    }

    /**
     * Handle Discord API errors
     */
    static handleDiscordError(error) {
        console.error('[Discord API Error]', error);
        
        if (error.code === 10003) {
            return this.formatError({ message: 'Unknown channel' });
        }
        
        if (error.code === 10004) {
            return this.formatError({ message: 'Unknown guild' });
        }
        
        if (error.code === 10008) {
            return this.formatError({ message: 'Unknown message' });
        }
        
        if (error.code === 10011) {
            return this.formatError({ message: 'Unknown role' });
        }
        
        if (error.code === 10013) {
            return this.formatError({ message: 'Unknown user' });
        }
        
        if (error.code === 50001) {
            return this.formatError({ message: 'Missing access - bot lacks permissions' });
        }
        
        if (error.code === 50013) {
            return this.formatError({ message: 'Missing permissions' });
        }
        
        return this.formatError(error, 'Discord API error');
    }
}

module.exports = APIErrorHandler;
