/**
 * Event Loader - Loads and registers Discord.js event handlers
 * This module provides a centralized way to load event handlers from files.
 */

const fs = require('fs');
const path = require('path');

class EventLoader {
    constructor(client, bot, logger) {
        this.client = client;
        this.bot = bot;
        this.logger = logger;
        this.loadedEvents = new Map();
    }

    /**
     * Load all event handlers from a directory
     * @param {string} eventsPath - Path to the events directory
     */
    async loadEvents(eventsPath) {
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

        for (const file of eventFiles) {
            try {
                const filePath = path.join(eventsPath, file);
                const event = require(filePath);

                if (!event.name) {
                    this.logger.warn(`Event file ${file} is missing 'name' property, skipping.`);
                    continue;
                }

                this.registerEvent(event);
                this.loadedEvents.set(event.name, event);
                this.logger.debug(`📋 Loaded event handler: ${event.name}`);
            } catch (error) {
                this.logger.error(`❌ Failed to load event ${file}:`, error);
            }
        }

        this.logger.info(`📋 Loaded ${this.loadedEvents.size} event handlers`);
    }

    /**
     * Register a single event handler
     * @param {Object} event - Event object with name, once, and execute properties
     */
    registerEvent(event) {
        const handler = async (...args) => {
            try {
                await event.execute(...args, this.bot);
            } catch (error) {
                this.logger.error(`Error in event ${event.name}:`, error);
            }
        };

        if (event.once) {
            this.client.once(event.name, handler);
        } else {
            this.client.on(event.name, handler);
        }
    }

    /**
     * Register a custom event handler directly (for inline handlers)
     * @param {string} eventName - Name of the Discord.js event
     * @param {Function} handler - Event handler function
     * @param {boolean} once - Whether this is a one-time event
     */
    registerCustomEvent(eventName, handler, once = false) {
        const wrappedHandler = async (...args) => {
            try {
                await handler(...args);
            } catch (error) {
                this.logger.error(`Error in custom event ${eventName}:`, error);
            }
        };

        if (once) {
            this.client.once(eventName, wrappedHandler);
        } else {
            this.client.on(eventName, wrappedHandler);
        }
    }

    /**
     * Get a loaded event by name
     * @param {string} name - Event name
     */
    getEvent(name) {
        return this.loadedEvents.get(name);
    }

    /**
     * Check if an event is loaded
     * @param {string} name - Event name
     */
    hasEvent(name) {
        return this.loadedEvents.has(name);
    }
}

module.exports = EventLoader;
