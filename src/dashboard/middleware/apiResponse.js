/**
 * API Response Standardization Middleware
 * 
 * Provides consistent JSON response format across all API endpoints.
 * Attaches helper methods to the Express response object.
 * 
 * Standard response format:
 * {
 *   success: boolean,
 *   data?: any,          // present on success
 *   error?: string,      // present on error
 *   message?: string,    // optional human-readable message
 *   meta?: {             // optional metadata
 *     page, limit, total, timestamp
 *   }
 * }
 */

function apiResponseMiddleware(req, res, next) {
    /**
     * Send a success response
     * @param {any} data - Response data
     * @param {string} [message] - Optional message
     * @param {number} [statusCode=200] - HTTP status code
     */
    res.success = function (data, message, statusCode = 200) {
        const response = { success: true };
        if (data !== undefined && data !== null) response.data = data;
        if (message) response.message = message;
        response.meta = { timestamp: new Date().toISOString() };
        return res.status(statusCode).json(response);
    };

    /**
     * Send a paginated success response
     * @param {Array} data - Array of results
     * @param {{ page: number, limit: number, total: number }} pagination
     * @param {string} [message]
     */
    res.paginated = function (data, pagination, message) {
        const response = {
            success: true,
            data,
            meta: {
                page: pagination.page,
                limit: pagination.limit,
                total: pagination.total,
                totalPages: Math.ceil(pagination.total / pagination.limit),
                timestamp: new Date().toISOString()
            }
        };
        if (message) response.message = message;
        return res.status(200).json(response);
    };

    /**
     * Send an error response
     * @param {string} error - Error message
     * @param {number} [statusCode=500] - HTTP status code
     * @param {Object} [details] - Additional error details (only in non-production)
     */
    res.error = function (error, statusCode = 500, details) {
        const response = {
            success: false,
            error: error || 'Internal server error',
            meta: { timestamp: new Date().toISOString() }
        };
        // Only include details in non-production for debugging
        if (details && process.env.NODE_ENV !== 'production') {
            response.details = details;
        }
        return res.status(statusCode).json(response);
    };

    /**
     * Send a 404 Not Found response
     * @param {string} [message] - What was not found
     */
    res.notFound = function (message = 'Resource not found') {
        return res.error(message, 404);
    };

    /**
     * Send a 401 Unauthorized response
     * @param {string} [message]
     */
    res.unauthorized = function (message = 'Authentication required') {
        return res.error(message, 401);
    };

    /**
     * Send a 403 Forbidden response
     * @param {string} [message]
     */
    res.forbidden = function (message = 'Access denied') {
        return res.error(message, 403);
    };

    /**
     * Send a 400 Bad Request response
     * @param {string} [message]
     */
    res.badRequest = function (message = 'Bad request') {
        return res.error(message, 400);
    };

    /**
     * Send a 429 Rate Limited response
     * @param {string} [message]
     */
    res.rateLimited = function (message = 'Too many requests') {
        return res.error(message, 429);
    };

    next();
}

module.exports = apiResponseMiddleware;
