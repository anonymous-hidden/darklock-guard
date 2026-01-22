/**
 * Recreate channels from a snapshot JSON saved by snapshotManager.
 */
const fs = require('fs').promises;

async function restoreGuildFromSnapshot(guild, snapshot) {
  if (!snapshot || !snapshot.channels) return;

  // Build maps
  const channels = snapshot.channels.slice();
  // Sort: categories first, text, then voice
  const categories = channels.filter(c => c.type && c.type.toString().toLowerCase().includes('category'));
  const texts = channels.filter(c => c.type && c.type.toString().toLowerCase().includes('text'));
  const voices = channels.filter(c => c.type && c.type.toString().toLowerCase().includes('voice'));

  const createdMap = new Map(); // oldId -> newChannel

  // Helper to create channel with limited concurrency
  async function createChannel(chData, options = {}) {
    const createOptions = { type: chData.type, topic: chData.topic, nsfw: chData.nsfw, rateLimitPerUser: chData.rateLimitPerUser };
    try {
      const c = await guild.channels.create(chData.name, createOptions);
      createdMap.set(chData.id, c);
      // move to category later
      return c;
    } catch (e) {
      // ignore errors
      return null;
    }
  }

  // Create categories
  for (const cat of categories) {
    await createChannel(cat);
  }

  // Create text channels
  for (const t of texts) {
    const c = await createChannel(t);
    if (c && t.parentId && createdMap.has(t.parentId)) {
      await c.setParent(createdMap.get(t.parentId).id).catch(()=>{});
    }
  }

  // Create voice channels
  for (const v of voices) {
    const c = await createChannel(v);
    if (c && v.parentId && createdMap.has(v.parentId)) {
      await c.setParent(createdMap.get(v.parentId).id).catch(()=>{});
    }
  }

  // Restore order
  try {
    const ordered = Array.from(createdMap.values()).sort((a,b) => (a.position||0)-(b.position||0));
    for (let i=0;i<ordered.length;i++){
      await ordered[i].setPosition(i).catch(()=>{});
    }
  } catch(e){}

  // Restore permission overwrites best-effort
  for (const ch of channels) {
    const newCh = createdMap.get(ch.id);
    if (!newCh) continue;
    if (!ch.permissionOverwrites) continue;
    for (const po of ch.permissionOverwrites) {
      try {
        await newCh.permissionOverwrites.create(po.id, { allow: po.allow, deny: po.deny });
      } catch (e) {}
    }
  }

  return createdMap;
}

module.exports = { restoreGuildFromSnapshot };
