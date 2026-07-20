/**
 * Event Bus — singleton EventEmitter for cross-service communication.
 *
 * Events:
 *   message.created   { serverId, channelId, message }
 *   message.edited    { serverId, channelId, messageId, message }
 *   message.deleted   { serverId, channelId, messageId }
 *   typing.start      { serverId, channelId, userId, username }
 *   typing.stop       { serverId, channelId, userId }
 *   read.receipt       { serverId, channelId, userId, lastReadMessageId }
 *   security.alert    { serverId, channelId, userId, alertType, metadata }
 *   channel.lockdown  { serverId, channelId, active }
 *   channel.secured   { serverId, channelId, isSecure }
 *   presence.update   { userId, status }
 */
import { EventEmitter } from 'events';

class DarkLockEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  /** Emit a namespaced event with structured payload */
  fire(event, payload) {
    this.emit(event, { event, ts: Date.now(), ...payload });
  }
}

/** Singleton instance — import this everywhere */
export const eventBus = new DarkLockEventBus();
