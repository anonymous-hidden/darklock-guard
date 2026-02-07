# Discord Event Handler Audit & Deduplication Plan

**Date:** December 23, 2025  
**Current Status:** Multiple handlers registered per event  
**Target State:** Single handler per Discord.js event

---

## EXECUTIVE SUMMARY

The bot registers Discord.js event handlers in **at least 3 different locations**, causing some events to fire multiple times:

- `src/core/eventLoader.js` - Loads event files from `src/core/events/`
- `src/bot.js` - Direct handler registration (lines 770+, 1698+)
- `src/security/*.js` - Handlers in security modules (AntiNukeEngine, AntiNukeManager, auditWatcher, etc.)
- `src/security/permissionMonitor.js` - Event handlers inline

**Result:** Events like `channelDelete` execute 3 times, causing:
- Duplicate logging
- Potential race conditions
- Hard to debug which handler is doing what
- Performance impact

---

## CURRENT EVENT HANDLERS ANALYSIS

### EVENT HANDLER LOCATIONS

#### **Location 1: `src/core/eventLoader.js` → `src/core/events/` folder**

These are **centralized, modular, recommended**:

```
src/core/events/
├── clientReady.js           ✅ Handled here
├── interactionCreate.js     ✅ Handled here
├── messageCreate.js         ✅ Handled here
├── guildMemberAdd.js        ✅ Handled here
├── guildMemberRemove.js     ✅ Handled here
├── guildMemberUpdate.js     ✅ Handled here (1)
├── guildCreate.js           ✅ Handled here
├── voiceStateUpdate.js      ✅ Handled here
├── messageReactionAdd.js    ✅ Handled here
├── messageReactionRemove.js ✅ Handled here
├── antiNukeEvents.js        ✅ Handled here
├── error.js                 ✅ Handled here
├── warn.js                  ✅ Handled here
└── index.js                 (Loader)
```

**Loading mechanism** (`src/core/eventLoader.js`):
```javascript
async loadEvents(eventsPath) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(filePath);
        this.registerEvent(event);  // Calls client.on(event.name, handler)
    }
}
```

---

#### **Location 2: `src/bot.js` - Direct inline handlers**

Lines 770-1020+ have handlers that **may duplicate** core event handlers:

**Line 770:**
```javascript
// Custom internal event for guild config updates
this.client.on('guildConfigUpdate', async ({ guildId, settings }) => {
    // This is CUSTOM, not a Discord.js event - OK
});
```

**Line 938-951:** (In constructor)
```javascript
// Load event handlers from src/core/events/
const eventLoader = new EventLoader(this.client, this, this.logger);
await eventLoader.loadEvents(path.join(__dirname, 'core/events'));
```

**Potential inline handlers:**
```javascript
// These should be checked - may be duplicates of core/events/
client.on('ready', ...) // Line ~xxx
client.on('guildCreate', ...) // Line ~xxx
client.on('guildDelete', ...) // Line ~xxx
```

---

#### **Location 3: `src/security/` modules - MULTIPLE EVENT REGISTRATIONS**

These are **problematic duplicates**:

##### **AntiNukeEngine.js** (Line 40+)
```javascript
export function setupAntiNukeProtection(guild) {
    guild.client.on('channelDelete', async (channel) => {
        // Anti-nuke logic for channel deletion
    });
    
    guild.client.on('roleDelete', async (role) => {
        // Anti-nuke logic for role deletion
    });
    
    guild.client.on('guildBanAdd', async (ban) => {
        // Anti-nuke logic for ban addition
    });
}
```

**Events:** `channelDelete`, `roleDelete`, `guildBanAdd`

---

##### **AntiNukeManager.js** (Line 114+)
```javascript
client.on('channelDelete', async (channel) => {
    // Detects channel deletion
    // **DUPLICATE OF AntiNukeEngine.js**
});

client.on('channelCreate', async (channel) => {
    // Detects channel creation
});

client.on('antiNuke:channelDeleteBy', async ({ guildId, userId }) => {
    // Custom internal event - OK
});
```

**Events:** `channelDelete` (DUPLICATE), `channelCreate`

---

##### **auditWatcher.js** (Line 8+)
```javascript
client.on('channelDelete', async (channel) => {
    // **DUPLICATE - Third handler for same event**
    // Logs channel deletion for audit trail
});
```

**Events:** `channelDelete` (DUPLICATE)

---

##### **permissionMonitor.js** (Line 25+)
```javascript
class PermissionMonitor {
    constructor(client) {
        this.client = client;
    }

    initialize() {
        this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
            // Monitors permission changes
            // **Possibly duplicates guildMemberUpdate.js in core/events/**
        });

        this.client.on('roleUpdate', async (oldRole, newRole) => {
            // Monitors role changes
            // **Possibly duplicates role update logic elsewhere**
        });
    }
}
```

**Events:** `guildMemberUpdate` (DUPLICATE?), `roleUpdate` (DUPLICATE?)

---

##### **snapshotManager.js** (Line 43+)
```javascript
client.on('guildCreate', g => this._startForGuild(g));
// **Possibly duplicates guildCreate.js in core/events/**
```

**Events:** `guildCreate` (DUPLICATE?)

---

### DUPLICATE EVENT HANDLERS IDENTIFIED

| Event | Handler 1 | Handler 2 | Handler 3 | Problem |
|-------|-----------|-----------|-----------|---------|
| `channelDelete` | AntiNukeEngine | AntiNukeManager | auditWatcher | **TRIPLE** |
| `roleDelete` | AntiNukeEngine | ??? | ??? | Check |
| `guildBanAdd` | AntiNukeEngine | ??? | ??? | Check |
| `channelCreate` | AntiNukeManager | core/events? | ??? | Check |
| `guildMemberUpdate` | permissionMonitor | guildMemberUpdate.js? | ??? | **DOUBLE** |
| `roleUpdate` | permissionMonitor | ??? | ??? | Check |
| `guildCreate` | snapshotManager | guildCreate.js? | ??? | **DOUBLE?** |

---

## EVENT HANDLER CONSOLIDATION PLAN

### STEP 1: AUDIT ALL HANDLERS

Create a script to list all event listeners:

```javascript
// List all registered listeners
const listeners = this.client.eventNames();
for (const event of listeners) {
    const count = this.client.listeners(event).length;
    console.log(`[${count}x] ${event}`);
}
```

**This will show:**
```
[1x] ready
[1x] messageCreate
[2x] channelDelete     ← DUPLICATE!
[3x] guildMemberUpdate ← DUPLICATE!
...
```

---

### STEP 2: IDENTIFY OWNER OF EACH HANDLER

For every duplicate event, determine:
1. Which handler is the "authoritative" one?
2. What logic does each handler do?
3. Can they be merged?

**Example: `channelDelete`**

```
File 1: src/security/AntiNukeEngine.js
Purpose: Detect rapid channel deletions, trigger anti-nuke response
Logic: Count deletions in time window, kick/ban user if threshold exceeded

File 2: src/security/AntiNukeManager.js
Purpose: Detect channel deletions (duplicate?)
Logic: Stores deletion metadata

File 3: src/security/auditWatcher.js
Purpose: Audit trail logging
Logic: Log all channel deletions to audit_logs table
```

**Decision:** Keep ONE handler in `src/core/events/channelDelete.js` that:
1. Runs anti-nuke logic (from AntiNukeEngine)
2. Logs to audit trail (from auditWatcher)
3. Skips AntiNukeManager (appears to be metadata duplicate)

---

### STEP 3: CREATE CONSOLIDATED EVENT HANDLERS

For each duplicate event, create a single consolidated handler in `src/core/events/`:

#### **Example: src/core/events/channelDelete.js (NEW)**

```javascript
module.exports = {
    name: 'channelDelete',
    once: false,
    async execute(channel, bot) {
        const guildId = channel.guildId;
        const guild = channel.guild;

        try {
            // LOGIC FROM AntiNukeEngine
            if (bot.antiNuke?.handleChannelDelete) {
                await bot.antiNuke.handleChannelDelete(channel);
            }

            // LOGIC FROM auditWatcher
            if (bot.auditWatcher?.logChannelDeletion) {
                await bot.auditWatcher.logChannelDeletion(channel);
            }

            // SKIP: AntiNukeManager duplicate logic

        } catch (error) {
            bot.logger?.error(`Error in channelDelete handler:`, error);
        }
    }
};
```

**Result:** Single execution, all logic preserved, no duplication.

---

### STEP 4: DISABLE DUPLICATE REGISTRATIONS

Once consolidated handler is created:

**In `src/security/AntiNukeEngine.js`:**
```javascript
// BEFORE:
export function setupAntiNukeProtection(guild) {
    guild.client.on('channelDelete', async (channel) => {
        // Logic here
    });
}

// AFTER: Comment out and note reason
/*
export function setupAntiNukeProtection(guild) {
    // NOTE: channelDelete handler moved to src/core/events/channelDelete.js
    // This event is now handled by the centralized event system.
    // If you need to add anti-nuke logic, add it to core/events/channelDelete.js
    // or call bot.antiNuke methods from there.
}
*/
```

**In `src/security/AntiNukeManager.js`:**
```javascript
// BEFORE:
client.on('channelDelete', async (channel) => {
    // Duplicate logic
});

// AFTER: Remove entirely
// Moved to src/core/events/channelDelete.js
```

**In `src/security/auditWatcher.js`:**
```javascript
// BEFORE:
client.on('channelDelete', async (channel) => {
    // Audit logic
});

// AFTER: Comment out
/*
client.on('channelDelete', async (channel) => {
    // NOTE: Moved to src/core/events/channelDelete.js
    // The core event handler now calls auditWatcher.logChannelDeletion()
});
*/
```

---

### STEP 5: VERIFY SINGLE EXECUTION

After consolidation, test that each event fires exactly once:

```javascript
// Add logging to verify
if (!bot.eventCounters) bot.eventCounters = {};

const originalHandler = eventHandler.execute;
eventHandler.execute = async function(...args) {
    const eventName = this.name;
    bot.eventCounters[eventName] = (bot.eventCounters[eventName] || 0) + 1;
    
    if (bot.eventCounters[eventName] > 1) {
        bot.logger?.warn(`⚠️ WARNING: Event '${eventName}' fired ${bot.eventCounters[eventName]} times!`);
    }
    
    return originalHandler.apply(this, args);
};
```

**Expected output:** No warnings about duplicate fires.

---

## CONSOLIDATED EVENTS

Here are the suspected duplicates that need consolidation:

### Event: `channelDelete`
- **Current handlers:** AntiNukeEngine, AntiNukeManager, auditWatcher
- **Consolidate to:** `src/core/events/channelDelete.js`
- **Logic to preserve:** Anti-nuke detection + audit logging
- **Action:** Remove from 3 files, create new core handler

### Event: `roleDelete`
- **Current handlers:** AntiNukeEngine, others?
- **Status:** Needs audit
- **Action:** Check if duplicated, consolidate if needed

### Event: `guildBanAdd`
- **Current handlers:** AntiNukeEngine, others?
- **Status:** Needs audit
- **Action:** Check if duplicated, consolidate if needed

### Event: `channelCreate`
- **Current handlers:** AntiNukeManager, others?
- **Status:** Needs audit
- **Action:** Check if duplicated, consolidate if needed

### Event: `guildMemberUpdate`
- **Current handlers:** permissionMonitor.js, possibly core/events
- **Status:** Likely DUPLICATE
- **Action:** Consolidate into single handler

### Event: `roleUpdate`
- **Current handlers:** permissionMonitor.js, others?
- **Status:** Needs audit
- **Action:** Check if duplicated, consolidate if needed

### Event: `guildCreate`
- **Current handlers:** snapshotManager.js, possibly core/events
- **Status:** Likely DUPLICATE
- **Action:** Consolidate into single handler

---

## REFACTORED EVENT ARCHITECTURE

After consolidation:

```
src/bot.js
└── Initialize modules (without event registration)

src/core/eventLoader.js
└── Loads: src/core/events/*.js (SINGLE SOURCE OF TRUTH)
    ├── channelDelete.js       (includes anti-nuke + audit logic)
    ├── roleDelete.js
    ├── guildBanAdd.js
    ├── channelCreate.js
    ├── guildMemberUpdate.js   (includes permission monitor logic)
    ├── roleUpdate.js
    ├── guildCreate.js         (includes snapshot manager logic)
    ├── messageCreate.js
    ├── interactionCreate.js
    └── ... (other events)

src/security/ (NO MORE EVENT REGISTRATION)
└── Modules (AntiNukeEngine, permissionMonitor, etc.)
    └── Provide methods called BY event handlers
        Example: bot.antiNuke.handleChannelDelete(channel)
```

**Key principle:** Event handlers call module methods, not vice versa.

---

## IMPLEMENTATION CHECKLIST

- [ ] **Audit phase:** List all current event handlers by type
  - [ ] Run debug script to detect duplicates
  - [ ] Map each handler to its source file and logic

- [ ] **Decision phase:** For each duplicate event
  - [ ] Decide which logic is "primary"
  - [ ] Identify which logic to preserve from each handler
  - [ ] Plan merge strategy

- [ ] **Creation phase:** Create consolidated handlers
  - [ ] Create `src/core/events/` entry for each consolidated event
  - [ ] Include all original logic, merged appropriately
  - [ ] Add error handling and logging

- [ ] **Removal phase:** Disable old handlers
  - [ ] Comment out old handlers with migration notes
  - [ ] Update module initialization to not register events
  - [ ] Refactor modules to expose methods instead of registering handlers

- [ ] **Testing phase:** Verify single execution
  - [ ] Add event counter logging
  - [ ] Trigger each event and check counter = 1
  - [ ] Verify all logic still executes
  - [ ] Check logs for no duplicate entries

- [ ] **Cleanup phase:** Remove old event code
  - [ ] Delete commented-out handlers (after testing)
  - [ ] Update module documentation
  - [ ] Update architecture guide

---

## EVENT HANDLER INTERFACE

After consolidation, all core event handlers follow this interface:

```javascript
module.exports = {
    // Discord.js event name
    name: 'eventName',
    
    // If true, handler runs only once (client.once)
    once: false,
    
    // Handler function receives bot as last parameter
    async execute(arg1, arg2, arg3, bot) {
        try {
            // Event logic here
            
            // Call module methods
            if (bot.moduleA?.methodX) {
                await bot.moduleA.methodX(arg1);
            }
            if (bot.moduleB?.methodY) {
                await bot.moduleB.methodY(arg1);
            }
        } catch (error) {
            bot.logger?.error(`Error in ${this.name} handler:`, error);
        }
    }
};
```

**Advantages:**
- Single execution per event
- Clear dependency flow
- Easy to debug
- Easy to test
- Easy to add/remove logic

---

## ESTIMATED EFFORT

| Phase | Hours | Difficulty |
|-------|-------|-----------|
| Audit & mapping | 1-2 | LOW |
| Consolidate logic | 2-3 | MEDIUM |
| Create core handlers | 1-2 | MEDIUM |
| Remove old handlers | 1 | LOW |
| Testing & verification | 1-2 | MEDIUM |
| **TOTAL** | **6-10 hours** | - |

---

## ROLLBACK STRATEGY

If consolidation causes issues:

1. **Revert consolidation** - Uncomment old handlers
2. **Identify conflicting logic** - What's causing the issue?
3. **Fix conflict** - Update consolidation to handle it
4. **Re-deploy** - Retry with fix

Each event is independent, so can rollback individual events if needed.

---

## SUCCESS CRITERIA

✅ Each Discord.js event registered exactly once  
✅ All original event logic preserved  
✅ All logic executes without duplication  
✅ Logging shows single execution per event  
✅ No performance degradation  
✅ All modules still functional  
✅ No race conditions in event handling  

---

**Document Version:** 1.0  
**Status:** Ready for Audit Phase  
**Priority:** HIGH (duplicate events can cause data corruption)

