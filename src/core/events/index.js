/**
 * Core Events Index
 * Exports all event handlers for easy loading
 */

// Individual event handlers
const clientReady = require('./clientReady');
const interactionCreate = require('./interactionCreate');
const messageCreate = require('./messageCreate');
const guildMemberAdd = require('./guildMemberAdd');
const guildMemberRemove = require('./guildMemberRemove');
const guildMemberUpdate = require('./guildMemberUpdate');
const guildCreate = require('./guildCreate');
const voiceStateUpdate = require('./voiceStateUpdate');
const messageReactionAdd = require('./messageReactionAdd');
const messageReactionRemove = require('./messageReactionRemove');
const error = require('./error');
const warn = require('./warn');

// Anti-nuke events (exported as object with multiple handlers)
const antiNukeEvents = require('./antiNukeEvents');

module.exports = {
    // Main events
    clientReady,
    interactionCreate,
    messageCreate,
    guildMemberAdd,
    guildMemberRemove,
    guildMemberUpdate,
    guildCreate,
    voiceStateUpdate,
    messageReactionAdd,
    messageReactionRemove,
    error,
    warn,
    
    // Anti-nuke events
    ...antiNukeEvents,
    
    // Helper to get all events as array
    getAllEvents() {
        return [
            clientReady,
            interactionCreate,
            messageCreate,
            guildMemberAdd,
            guildMemberRemove,
            guildMemberUpdate,
            guildCreate,
            voiceStateUpdate,
            messageReactionAdd,
            messageReactionRemove,
            error,
            warn,
            // Anti-nuke events
            antiNukeEvents.roleCreate,
            antiNukeEvents.roleDelete,
            antiNukeEvents.roleUpdate,
            antiNukeEvents.channelCreate,
            antiNukeEvents.channelDelete,
            antiNukeEvents.channelUpdate,
            antiNukeEvents.guildBanAdd,
            antiNukeEvents.webhookUpdate,
            antiNukeEvents.guildMemberAddAntiNuke,
            antiNukeEvents.guildMemberRemoveAntiNuke
        ];
    }
};
