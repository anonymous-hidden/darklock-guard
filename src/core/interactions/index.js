/**
 * Core Interaction Handlers Index
 * Central export point for all extracted interaction handlers
 */

const buttonHandlers = require('./buttonHandlers');
const ticketHandlers = require('./ticketHandlers');
const antiNukeHandlers = require('./antiNukeHandlers');
const helpHandlers = require('./helpHandlers');

module.exports = {
    // Button handlers
    handleButtonInteraction: buttonHandlers.handleButtonInteraction,
    handleSpamAction: buttonHandlers.handleSpamAction,
    
    // Ticket handlers
    handleTicketCreate: ticketHandlers.handleTicketCreate,
    handleTicketClose: ticketHandlers.handleTicketClose,
    handleTicketCreateModal: ticketHandlers.handleTicketCreateModal,
    handleTicketSubmit: ticketHandlers.handleTicketSubmit,
    handleTicketClaim: ticketHandlers.handleTicketClaim,
    
    // Anti-nuke handlers
    handleRoleCreate: antiNukeHandlers.handleRoleCreate,
    handleRoleDelete: antiNukeHandlers.handleRoleDelete,
    handleRoleUpdate: antiNukeHandlers.handleRoleUpdate,
    handleChannelCreate: antiNukeHandlers.handleChannelCreate,
    handleChannelDelete: antiNukeHandlers.handleChannelDelete,
    handleChannelUpdate: antiNukeHandlers.handleChannelUpdate,
    handleBanAdd: antiNukeHandlers.handleBanAdd,
    handleWebhookUpdate: antiNukeHandlers.handleWebhookUpdate,
    handleMemberRemove: antiNukeHandlers.handleMemberRemove,
    handleBotAdd: antiNukeHandlers.handleBotAdd,
    
    // Help handlers
    handleHelpModal: helpHandlers.handleHelpModal,
    handleHelpTicketModal: helpHandlers.handleHelpTicketModal
};
