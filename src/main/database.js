"use strict";

const path = require("node:path");
const fs = require("node:fs");
const log = require("electron-log/main");

let db = null;
let isNativeSqlite = false;

// Memory/File fallback store in case native node:sqlite is not initialized yet
let fallbackStore = {
  auth_sessions: new Map(),
  cached_conversations: new Map(),
  cached_messages: new Map(),
  cached_sms: new Map(),
  cached_contacts: new Map(),
  offline_outbox_queue: new Map(),
  app_kv_store: new Map(),
};
let fallbackFilePath = null;

function loadFallbackStore(dbDir) {
  try {
    fallbackFilePath = path.join(dbDir, "vitelglobal_fallback_store.json");
    if (fs.existsSync(fallbackFilePath)) {
      const raw = fs.readFileSync(fallbackFilePath, "utf8");
      const parsed = JSON.parse(raw);
      for (const [tbl, rows] of Object.entries(parsed)) {
        if (fallbackStore[tbl]) {
          fallbackStore[tbl] = new Map(Object.entries(rows || {}));
        }
      }
    }
  } catch (err) {
    log.warn("[SQLite] Failed to load fallback JSON store:", err);
  }
}

function persistFallbackStore() {
  if (!fallbackFilePath) return;
  try {
    const serialized = {};
    for (const [tbl, map] of Object.entries(fallbackStore)) {
      serialized[tbl] = Object.fromEntries(map.entries());
    }
    fs.writeFileSync(fallbackFilePath, JSON.stringify(serialized, null, 2), "utf8");
  } catch (err) {
    log.warn("[SQLite] Failed to persist fallback store:", err);
  }
}

/**
 * Initialize SQLite Database in user data directory
 * @param {string} userDataPath
 */
function initializeDatabase(userDataPath) {
  try {
    const dbDir = path.resolve(userDataPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    loadFallbackStore(dbDir);

    const dbPath = path.join(dbDir, "vitelglobal_offline.sqlite");
    log.info("[SQLite] Initializing database at:", dbPath);

    // Try Node.js 22 built-in node:sqlite module
    try {
      const { DatabaseSync } = require("node:sqlite");
      db = new DatabaseSync(dbPath);
      isNativeSqlite = true;
      log.info("[SQLite] Successfully initialized native node:sqlite engine.");
    } catch (nativeErr) {
      log.warn("[SQLite] node:sqlite not available, falling back to resilient structured storage:", nativeErr?.message);
      isNativeSqlite = false;
    }

    if (isNativeSqlite && db) {
      // Enable WAL mode for high performance concurrent reads and writes
      try {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA synchronous = NORMAL;");
      } catch (pragmaErr) {
        log.warn("[SQLite] Could not set PRAGMA:", pragmaErr?.message);
      }

      // 1. Auth sessions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          user_id TEXT PRIMARY KEY,
          token TEXT,
          customer_token TEXT,
          user_snapshot TEXT,
          host_name TEXT,
          extension TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );
      `);

      // 2. Cached conversations table
      db.exec(`
        CREATE TABLE IF NOT EXISTS cached_conversations (
          id TEXT PRIMARY KEY,
          type TEXT,
          title TEXT,
          data TEXT,
          last_message TEXT,
          unread_count INTEGER DEFAULT 0,
          updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_updated ON cached_conversations(updated_at DESC);
      `);

      // 3. Cached chat messages table
      db.exec(`
        CREATE TABLE IF NOT EXISTS cached_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          sender_id TEXT,
          content TEXT,
          attachments TEXT,
          status TEXT,
          timestamp INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON cached_messages(conversation_id, timestamp ASC);
      `);

      // 4. Cached SMS table
      db.exec(`
        CREATE TABLE IF NOT EXISTS cached_sms (
          id TEXT PRIMARY KEY,
          line TEXT,
          peer_number TEXT,
          message TEXT,
          filepath TEXT,
          is_outgoing INTEGER DEFAULT 0,
          timestamp INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sms_peer ON cached_sms(line, peer_number, timestamp ASC);
      `);

      // 5. Cached contacts table
      db.exec(`
        CREATE TABLE IF NOT EXISTS cached_contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          name TEXT,
          phone TEXT,
          email TEXT,
          ext TEXT,
          data TEXT,
          updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_name ON cached_contacts(name);
      `);

      // 6. Offline outbox mutation queue table
      db.exec(`
        CREATE TABLE IF NOT EXISTS offline_outbox_queue (
          id TEXT PRIMARY KEY,
          action TEXT,
          endpoint TEXT,
          payload TEXT,
          status TEXT DEFAULT 'pending',
          retry_count INTEGER DEFAULT 0,
          created_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON offline_outbox_queue(status, created_at ASC);
      `);

      // 7. Generic Key-Value table for app preferences & sync states
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_kv_store (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );
      `);

      log.info("[SQLite] All database tables and indexes verified successfully.");
    }
  } catch (err) {
    log.error("[SQLite] Error during database initialization:", err);
  }
}

// -----------------------------------------------------------------------------
// Session Operations
// -----------------------------------------------------------------------------

function saveSession(sessionData) {
  if (!sessionData || !sessionData.userId) return false;
  const now = Date.now();
  const userId = String(sessionData.userId);
  const token = String(sessionData.token || "");
  const customerToken = String(sessionData.customerToken || "");
  const userSnapshot = JSON.stringify(sessionData.user || {});
  const hostName = String(sessionData.hostName || "");
  const extension = String(sessionData.extension || "");

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO auth_sessions (user_id, token, customer_token, user_snapshot, host_name, extension, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          token = excluded.token,
          customer_token = excluded.customer_token,
          user_snapshot = excluded.user_snapshot,
          host_name = excluded.host_name,
          extension = excluded.extension,
          updated_at = excluded.updated_at
      `);
      stmt.run(userId, token, customerToken, userSnapshot, hostName, extension, now, now);
      return true;
    } catch (err) {
      log.error("[SQLite] saveSession error:", err);
    }
  }

  // Fallback map
  fallbackStore.auth_sessions.set(userId, {
    user_id: userId,
    token,
    customer_token: customerToken,
    user_snapshot: userSnapshot,
    host_name: hostName,
    extension,
    updated_at: now,
  });
  persistFallbackStore();
  return true;
}

function getLatestSession() {
  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`SELECT * FROM auth_sessions ORDER BY updated_at DESC LIMIT 1`);
      const row = stmt.get();
      if (row) {
        return {
          userId: row.user_id,
          token: row.token,
          customerToken: row.customer_token,
          user: row.user_snapshot ? JSON.parse(row.user_snapshot) : null,
          hostName: row.host_name,
          extension: row.extension,
          updatedAt: row.updated_at,
        };
      }
      return null;
    } catch (err) {
      log.error("[SQLite] getLatestSession error:", err);
    }
  }

  // Fallback map
  let latest = null;
  for (const session of fallbackStore.auth_sessions.values()) {
    if (!latest || session.updated_at > latest.updated_at) {
      latest = session;
    }
  }
  if (latest) {
    return {
      userId: latest.user_id,
      token: latest.token,
      customerToken: latest.customer_token,
      user: latest.user_snapshot ? JSON.parse(latest.user_snapshot) : null,
      hostName: latest.host_name,
      extension: latest.extension,
      updatedAt: latest.updated_at,
    };
  }
  return null;
}

function clearSession(userId = null) {
  if (isNativeSqlite && db) {
    try {
      if (userId) {
        const stmt = db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`);
        stmt.run(String(userId));
      } else {
        db.exec(`DELETE FROM auth_sessions`);
        db.exec(`DELETE FROM cached_conversations`);
        db.exec(`DELETE FROM cached_messages`);
        db.exec(`DELETE FROM cached_sms`);
        db.exec(`DELETE FROM cached_contacts`);
        db.exec(`DELETE FROM offline_outbox`);
        db.exec(`DELETE FROM kv_store`);
      }
      return true;
    } catch (err) {
      log.error("[SQLite] clearSession error:", err);
    }
  }

  if (userId) {
    fallbackStore.auth_sessions.delete(String(userId));
  } else {
    fallbackStore.auth_sessions.clear();
    fallbackStore.cached_conversations.clear();
    fallbackStore.cached_messages.clear();
    fallbackStore.cached_sms.clear();
    fallbackStore.cached_contacts.clear();
    fallbackStore.offline_outbox = [];
    fallbackStore.kv_store.clear();
  }
  persistFallbackStore();
  return true;
}

// -----------------------------------------------------------------------------
// Conversations & Messages Operations
// -----------------------------------------------------------------------------

function saveConversations(conversations = []) {
  if (!Array.isArray(conversations) || conversations.length === 0) return true;
  const now = Date.now();

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO cached_conversations (id, type, title, data, last_message, unread_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          data = excluded.data,
          last_message = excluded.last_message,
          unread_count = excluded.unread_count,
          updated_at = excluded.updated_at
      `);

      for (const conv of conversations) {
        if (!conv || !conv.id) continue;
        stmt.run(
          String(conv.id),
          String(conv.type || "direct"),
          String(conv.title || conv.name || ""),
          JSON.stringify(conv),
          JSON.stringify(conv.lastMessage || conv.last_message || null),
          Number(conv.unreadCount || conv.unread_count || 0),
          Number(conv.updatedAt || conv.updated_at || now)
        );
      }
      return true;
    } catch (err) {
      log.error("[SQLite] saveConversations error:", err);
    }
  }

  for (const conv of conversations) {
    if (!conv || !conv.id) continue;
    fallbackStore.cached_conversations.set(String(conv.id), conv);
  }
  persistFallbackStore();
  return true;
}

function getConversations() {
  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`SELECT data FROM cached_conversations ORDER BY updated_at DESC`);
      const rows = stmt.all();
      return rows.map((r) => JSON.parse(r.data));
    } catch (err) {
      log.error("[SQLite] getConversations error:", err);
    }
  }

  return Array.from(fallbackStore.cached_conversations.values());
}

function saveMessages(conversationId, messages = []) {
  if (!conversationId || !Array.isArray(messages) || messages.length === 0) return true;

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO cached_messages (id, conversation_id, sender_id, content, attachments, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          attachments = excluded.attachments,
          status = excluded.status,
          timestamp = excluded.timestamp
      `);

      for (const msg of messages) {
        if (!msg || !msg.id) continue;
        stmt.run(
          String(msg.id),
          String(conversationId),
          String(msg.senderId || msg.sender_id || ""),
          String(msg.content || msg.body || msg.text || ""),
          JSON.stringify(msg.attachments || []),
          String(msg.status || "delivered"),
          Number(new Date(msg.createdAt || msg.timestamp || Date.now()).getTime())
        );
      }
      return true;
    } catch (err) {
      log.error("[SQLite] saveMessages error:", err);
    }
  }

  for (const msg of messages) {
    if (!msg || !msg.id) continue;
    fallbackStore.cached_messages.set(`${conversationId}_${msg.id}`, msg);
  }
  persistFallbackStore();
  return true;
}

function getMessages(conversationId) {
  if (!conversationId) return [];

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM cached_messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
      `);
      const rows = stmt.all(String(conversationId));
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        senderId: r.sender_id,
        content: r.content,
        attachments: r.attachments ? JSON.parse(r.attachments) : [],
        status: r.status,
        timestamp: r.timestamp,
        createdAt: new Date(r.timestamp).toISOString(),
      }));
    } catch (err) {
      log.error("[SQLite] getMessages error:", err);
    }
  }

  const results = [];
  for (const [key, msg] of fallbackStore.cached_messages.entries()) {
    if (key.startsWith(`${conversationId}_`)) {
      results.push(msg);
    }
  }
  return results;
}

// -----------------------------------------------------------------------------
// SMS & MMS Operations
// -----------------------------------------------------------------------------

function saveSmsMessages(line, peerNumber, messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return true;

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO cached_sms (id, line, peer_number, message, filepath, is_outgoing, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          message = excluded.message,
          filepath = excluded.filepath,
          is_outgoing = excluded.is_outgoing,
          timestamp = excluded.timestamp
      `);

      for (const msg of messages) {
        if (!msg) continue;
        const msgId = String(msg.id || `${line}_${peerNumber}_${msg.timestamp || Date.now()}_${Math.random()}`);
        stmt.run(
          msgId,
          String(line || ""),
          String(peerNumber || ""),
          String(msg.message || msg.text || msg.body || ""),
          String(msg.filepath || msg.img_url || msg.file_url || ""),
          msg.is_outgoing || msg.direction === "outbound" ? 1 : 0,
          Number(new Date(msg.timestamp || msg.created_at || Date.now()).getTime())
        );
      }
      return true;
    } catch (err) {
      log.error("[SQLite] saveSmsMessages error:", err);
    }
  }

  for (const msg of messages) {
    if (!msg) continue;
    const msgId = String(msg.id || `${line}_${peerNumber}_${Date.now()}_${Math.random()}`);
    fallbackStore.cached_sms.set(msgId, { ...msg, line, peerNumber });
  }
  persistFallbackStore();
  return true;
}

function getSmsMessages(line, peerNumber) {
  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM cached_sms
        WHERE (line = ? OR ? = '') AND (peer_number = ? OR ? = '')
        ORDER BY timestamp ASC
      `);
      const rows = stmt.all(String(line || ""), String(line || ""), String(peerNumber || ""), String(peerNumber || ""));
      return rows.map((r) => ({
        id: r.id,
        line: r.line,
        peer_number: r.peer_number,
        message: r.message,
        filepath: r.filepath,
        is_outgoing: Boolean(r.is_outgoing),
        timestamp: new Date(r.timestamp).toISOString(),
      }));
    } catch (err) {
      log.error("[SQLite] getSmsMessages error:", err);
    }
  }

  const results = [];
  for (const sms of fallbackStore.cached_sms.values()) {
    if ((!line || sms.line === line) && (!peerNumber || sms.peerNumber === peerNumber || sms.peer_number === peerNumber)) {
      results.push(sms);
    }
  }
  return results;
}

// -----------------------------------------------------------------------------
// Contacts Operations
// -----------------------------------------------------------------------------

function saveContacts(contacts = []) {
  if (!Array.isArray(contacts) || contacts.length === 0) return true;
  const now = Date.now();

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO cached_contacts (id, user_id, name, phone, email, ext, data, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          email = excluded.email,
          ext = excluded.ext,
          data = excluded.data,
          updated_at = excluded.updated_at
      `);

      for (const c of contacts) {
        if (!c || !c.id) continue;
        stmt.run(
          String(c.id),
          String(c.userId || c.user_id || ""),
          String(c.name || c.full_name || c.displayName || ""),
          String(c.phone || c.phoneNumber || c.mobile || ""),
          String(c.email || ""),
          String(c.ext || c.extension || ""),
          JSON.stringify(c),
          now
        );
      }
      return true;
    } catch (err) {
      log.error("[SQLite] saveContacts error:", err);
    }
  }

  for (const c of contacts) {
    if (!c || !c.id) continue;
    fallbackStore.cached_contacts.set(String(c.id), c);
  }
  persistFallbackStore();
  return true;
}

function getContacts() {
  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`SELECT data FROM cached_contacts ORDER BY name ASC`);
      const rows = stmt.all();
      return rows.map((r) => JSON.parse(r.data));
    } catch (err) {
      log.error("[SQLite] getContacts error:", err);
    }
  }

  return Array.from(fallbackStore.cached_contacts.values());
}

// -----------------------------------------------------------------------------
// Offline Outbox Queue Operations
// -----------------------------------------------------------------------------

function enqueueOutboxMutation(mutation) {
  if (!mutation || !mutation.endpoint) return false;
  const id = String(mutation.id || `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const now = Date.now();

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO offline_outbox_queue (id, action, endpoint, payload, status, retry_count, created_at)
        VALUES (?, ?, ?, ?, 'pending', 0, ?)
      `);
      stmt.run(
        id,
        String(mutation.action || "POST"),
        String(mutation.endpoint),
        JSON.stringify(mutation.payload || {}),
        now
      );
      return id;
    } catch (err) {
      log.error("[SQLite] enqueueOutboxMutation error:", err);
    }
  }

  fallbackStore.offline_outbox_queue.set(id, {
    id,
    action: mutation.action || "POST",
    endpoint: mutation.endpoint,
    payload: mutation.payload || {},
    status: "pending",
    retry_count: 0,
    created_at: now,
  });
  persistFallbackStore();
  return id;
}

function getPendingOutboxMutations() {
  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM offline_outbox_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
      `);
      const rows = stmt.all();
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        endpoint: r.endpoint,
        payload: r.payload ? JSON.parse(r.payload) : {},
        retryCount: r.retry_count,
        createdAt: r.created_at,
      }));
    } catch (err) {
      log.error("[SQLite] getPendingOutboxMutations error:", err);
    }
  }

  return Array.from(fallbackStore.offline_outbox_queue.values()).filter((m) => m.status === "pending");
}

function dequeueOutboxMutation(id) {
  if (!id) return false;

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`DELETE FROM offline_outbox_queue WHERE id = ?`);
      stmt.run(String(id));
      return true;
    } catch (err) {
      log.error("[SQLite] dequeueOutboxMutation error:", err);
    }
  }

  fallbackStore.offline_outbox_queue.delete(String(id));
  persistFallbackStore();
  return true;
}

// -----------------------------------------------------------------------------
// Generic Key-Value Store
// -----------------------------------------------------------------------------

function setKV(key, value) {
  if (!key) return false;
  const now = Date.now();
  const serialized = JSON.stringify(value);

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO app_kv_store (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      stmt.run(String(key), serialized, now);
      return true;
    } catch (err) {
      log.error("[SQLite] setKV error:", err);
    }
  }

  fallbackStore.app_kv_store.set(String(key), { value: serialized, updated_at: now });
  persistFallbackStore();
  return true;
}

function getKV(key) {
  if (!key) return null;

  if (isNativeSqlite && db) {
    try {
      const stmt = db.prepare(`SELECT value FROM app_kv_store WHERE key = ?`);
      const row = stmt.get(String(key));
      if (row && row.value) {
        return JSON.parse(row.value);
      }
      return null;
    } catch (err) {
      log.error("[SQLite] getKV error:", err);
    }
  }

  const found = fallbackStore.app_kv_store.get(String(key));
  return found?.value ? JSON.parse(found.value) : null;
}

module.exports = {
  initializeDatabase,
  saveSession,
  getLatestSession,
  clearSession,
  saveConversations,
  getConversations,
  saveMessages,
  getMessages,
  saveSmsMessages,
  getSmsMessages,
  saveContacts,
  getContacts,
  enqueueOutboxMutation,
  getPendingOutboxMutations,
  dequeueOutboxMutation,
  setKV,
  getKV,
};
