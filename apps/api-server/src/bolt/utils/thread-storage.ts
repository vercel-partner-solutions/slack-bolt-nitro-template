/**
 * Thread Storage
 *
 * Maps Inbound email threadIds to Slack message timestamps (thread_ts).
 * Also provides idempotency tracking for processed emails and Slack messages.
 *
 * Flow:
 * 1. Email arrives with threadId → Check if already processed (idempotency)
 * 2. If duplicate: Skip processing
 * 3. If exists: Post to existing thread
 * 4. If new: Create new Slack message and store mapping
 * 5. User replies in Slack thread → Check if already sent (idempotency) → Send via inbound.reply()
 *
 * Idempotency:
 * - Tracks processed email IDs to prevent duplicate webhook processing
 * - Tracks processed Slack message timestamps to prevent duplicate email sends
 *
 * Storage:
 * - Uses Redis (Upstash) for persistent storage when UPSTASH_REDIS_REST_URL is set
 * - Falls back to in-memory storage if Redis is not configured (not recommended for production)
 */

import { Redis } from '@upstash/redis';

export interface EmailRecipients {
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  from?: { name?: string; address: string };
}

interface ThreadStorage {
  set(inboundThreadId: string, slackThreadTs: string, emailId: string, channelId: string): Promise<void>;
  getSlackThreadTs(inboundThreadId: string): Promise<string | null>;
  getInboundThreadId(slackThreadTs: string): Promise<string | null>;
  getEmailId(slackThreadTs: string): Promise<string | null>;
  getChannelId(inboundThreadId: string): Promise<string | null>;
  getChannelIdBySlackTs(slackThreadTs: string): Promise<string | null>;
  setEmailRecipients(slackThreadTs: string, recipients: EmailRecipients): Promise<void>;
  getEmailRecipients(slackThreadTs: string): Promise<EmailRecipients | null>;
  hasProcessedEmail(emailId: string): Promise<boolean>;
  markEmailProcessed(emailId: string): Promise<void>;
  checkAndMarkEmailProcessed(emailId: string): Promise<boolean>;
  hasProcessedEmailFingerprint(fingerprint: string): Promise<boolean>;
  checkAndMarkEmailFingerprint(fingerprint: string): Promise<boolean>;
  markEmailSentByUs(identifier: string): Promise<void>;
  wasEmailSentByUs(identifier: string): Promise<boolean>;
  markSlackMessageProcessed(messageTs: string): Promise<void>;
  hasProcessedSlackMessage(messageTs: string): Promise<boolean>;
  checkAndMarkSlackMessageProcessed(messageTs: string): Promise<boolean>;
  setEmailWorkspace(emailId: string, teamId: string): Promise<void>;
  getEmailWorkspace(emailId: string): Promise<string | null>;
}

// In-memory storage (not persistent across restarts)
class InMemoryThreadStorage implements ThreadStorage {
  private inboundToSlack = new Map<string, { slackThreadTs: string; emailId: string; channelId: string }>();
  private slackToInbound = new Map<string, string>();
  private slackToChannel = new Map<string, string>();
  private emailRecipients = new Map<string, EmailRecipients>();
  private processedEmails = new Set<string>();
  private processedEmailFingerprints = new Set<string>();
  private sentByUs = new Set<string>(); // Track emails we sent (by Message-ID or fingerprint)
  private processedSlackMessages = new Set<string>();
  private emailToWorkspace = new Map<string, string>(); // Map email ID to team ID

  async set(inboundThreadId: string, slackThreadTs: string, emailId: string, channelId: string): Promise<void> {
    this.inboundToSlack.set(inboundThreadId, { slackThreadTs, emailId, channelId });
    this.slackToInbound.set(slackThreadTs, inboundThreadId);
    this.slackToChannel.set(slackThreadTs, channelId);
    this.processedEmails.add(emailId);
  }

  async getSlackThreadTs(inboundThreadId: string): Promise<string | null> {
    return this.inboundToSlack.get(inboundThreadId)?.slackThreadTs || null;
  }

  async getInboundThreadId(slackThreadTs: string): Promise<string | null> {
    return this.slackToInbound.get(slackThreadTs) || null;
  }

  async getEmailId(slackThreadTs: string): Promise<string | null> {
    const inboundThreadId = await this.getInboundThreadId(slackThreadTs);
    if (!inboundThreadId) return null;
    return this.inboundToSlack.get(inboundThreadId)?.emailId || null;
  }

  async getChannelId(inboundThreadId: string): Promise<string | null> {
    return this.inboundToSlack.get(inboundThreadId)?.channelId || null;
  }

  async getChannelIdBySlackTs(slackThreadTs: string): Promise<string | null> {
    return this.slackToChannel.get(slackThreadTs) || null;
  }

  async setEmailRecipients(slackThreadTs: string, recipients: EmailRecipients): Promise<void> {
    this.emailRecipients.set(slackThreadTs, recipients);
  }

  async getEmailRecipients(slackThreadTs: string): Promise<EmailRecipients | null> {
    return this.emailRecipients.get(slackThreadTs) || null;
  }

  async hasProcessedEmail(emailId: string): Promise<boolean> {
    return this.processedEmails.has(emailId);
  }

  async markEmailProcessed(emailId: string): Promise<void> {
    this.processedEmails.add(emailId);
  }

  /**
   * Atomically check if email has been processed, and if not, mark it as processed.
   * @returns true if email was already processed, false if this is the first time
   */
  async checkAndMarkEmailProcessed(emailId: string): Promise<boolean> {
    if (this.processedEmails.has(emailId)) {
      return true; // Already processed
    }
    this.processedEmails.add(emailId);
    return false; // First time processing
  }

  async hasProcessedEmailFingerprint(fingerprint: string): Promise<boolean> {
    return this.processedEmailFingerprints.has(fingerprint);
  }

  async checkAndMarkEmailFingerprint(fingerprint: string): Promise<boolean> {
    if (this.processedEmailFingerprints.has(fingerprint)) {
      return true; // Already processed
    }
    this.processedEmailFingerprints.add(fingerprint);
    return false; // First time processing
  }

  async markEmailSentByUs(identifier: string): Promise<void> {
    this.sentByUs.add(identifier);
  }

  async wasEmailSentByUs(identifier: string): Promise<boolean> {
    return this.sentByUs.has(identifier);
  }

  async markSlackMessageProcessed(messageTs: string): Promise<void> {
    this.processedSlackMessages.add(messageTs);
  }

  async hasProcessedSlackMessage(messageTs: string): Promise<boolean> {
    return this.processedSlackMessages.has(messageTs);
  }

  /**
   * Atomically check if Slack message has been processed, and if not, mark it as processed.
   * @returns true if message was already processed, false if this is the first time
   */
  async checkAndMarkSlackMessageProcessed(messageTs: string): Promise<boolean> {
    if (this.processedSlackMessages.has(messageTs)) {
      return true; // Already processed
    }
    this.processedSlackMessages.add(messageTs);
    return false; // First time processing
  }

  async setEmailWorkspace(emailId: string, teamId: string): Promise<void> {
    this.emailToWorkspace.set(emailId, teamId);
  }

  async getEmailWorkspace(emailId: string): Promise<string | null> {
    return this.emailToWorkspace.get(emailId) || null;
  }
}

// Redis storage with Upstash
class RedisThreadStorage implements ThreadStorage {
  private redis: Redis;

  constructor(redisUrl: string, redisToken: string) {
    this.redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
  }

  async set(inboundThreadId: string, slackThreadTs: string, emailId: string, channelId: string): Promise<void> {
    await Promise.all([
      this.redis.set(`inbound:${inboundThreadId}`, JSON.stringify({ slackThreadTs, emailId, channelId })),
      this.redis.set(`slack:${slackThreadTs}`, inboundThreadId),
      this.redis.set(`channel:${slackThreadTs}`, channelId),
      this.redis.set(`email:${emailId}`, '1'), // Mark as processed
    ]);
  }

  async getSlackThreadTs(inboundThreadId: string): Promise<string | null> {
    const data = await this.redis.get<{ slackThreadTs: string; emailId: string; channelId: string }>(`inbound:${inboundThreadId}`);
    if (!data) return null;
    // Upstash Redis auto-deserializes JSON, so data is already an object
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return parsed.slackThreadTs;
    }
    return data.slackThreadTs;
  }

  async getInboundThreadId(slackThreadTs: string): Promise<string | null> {
    return await this.redis.get<string>(`slack:${slackThreadTs}`);
  }

  async getEmailId(slackThreadTs: string): Promise<string | null> {
    const inboundThreadId = await this.getInboundThreadId(slackThreadTs);
    if (!inboundThreadId) return null;
    const data = await this.redis.get<{ slackThreadTs: string; emailId: string; channelId: string }>(`inbound:${inboundThreadId}`);
    if (!data) return null;
    // Upstash Redis auto-deserializes JSON, so data is already an object
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return parsed.emailId;
    }
    return data.emailId;
  }

  async getChannelId(inboundThreadId: string): Promise<string | null> {
    const data = await this.redis.get<{ slackThreadTs: string; emailId: string; channelId: string }>(`inbound:${inboundThreadId}`);
    if (!data) return null;
    // Upstash Redis auto-deserializes JSON, so data is already an object
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return parsed.channelId;
    }
    return data.channelId;
  }

  async getChannelIdBySlackTs(slackThreadTs: string): Promise<string | null> {
    return await this.redis.get<string>(`channel:${slackThreadTs}`);
  }

  async setEmailRecipients(slackThreadTs: string, recipients: EmailRecipients): Promise<void> {
    await this.redis.set(`recipients:${slackThreadTs}`, JSON.stringify(recipients));
  }

  async getEmailRecipients(slackThreadTs: string): Promise<EmailRecipients | null> {
    const data = await this.redis.get<EmailRecipients | string>(`recipients:${slackThreadTs}`);
    if (!data) return null;
    // Upstash Redis auto-deserializes JSON, so data is already an object
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    return data;
  }

  async hasProcessedEmail(emailId: string): Promise<boolean> {
    const result = await this.redis.get(`email:${emailId}`);
    return result !== null;
  }

  async markEmailProcessed(emailId: string): Promise<void> {
    await this.redis.set(`email:${emailId}`, '1');
  }

  async checkAndMarkEmailProcessed(emailId: string): Promise<boolean> {
    // Use Redis SETNX (SET if Not eXists) for atomic check-and-set
    const result = await this.redis.setnx(`email:${emailId}`, '1');
    return result === 0; // Returns 0 if key already existed (already processed)
  }

  async hasProcessedEmailFingerprint(fingerprint: string): Promise<boolean> {
    const result = await this.redis.get(`emailfp:${fingerprint}`);
    return result !== null;
  }

  async checkAndMarkEmailFingerprint(fingerprint: string): Promise<boolean> {
    // Use Redis SETNX (SET if Not eXists) for atomic check-and-set
    // Set with 24 hour expiration to prevent storage bloat
    const result = await this.redis.setnx(`emailfp:${fingerprint}`, '1');
    if (result === 1) {
      // First time - set expiration
      await this.redis.expire(`emailfp:${fingerprint}`, 86400); // 24 hours
    }
    return result === 0; // Returns 0 if key already existed (already processed)
  }

  async markEmailSentByUs(identifier: string): Promise<void> {
    // Store with 24 hour expiration to prevent storage bloat
    await this.redis.set(`sentbyus:${identifier}`, '1');
    await this.redis.expire(`sentbyus:${identifier}`, 86400); // 24 hours
  }

  async wasEmailSentByUs(identifier: string): Promise<boolean> {
    const result = await this.redis.get(`sentbyus:${identifier}`);
    return result !== null;
  }

  async markSlackMessageProcessed(messageTs: string): Promise<void> {
    await this.redis.set(`slackmsg:${messageTs}`, '1');
  }

  async hasProcessedSlackMessage(messageTs: string): Promise<boolean> {
    const result = await this.redis.get(`slackmsg:${messageTs}`);
    return result !== null;
  }

  async checkAndMarkSlackMessageProcessed(messageTs: string): Promise<boolean> {
    // Use Redis SETNX (SET if Not eXists) for atomic check-and-set
    const result = await this.redis.setnx(`slackmsg:${messageTs}`, '1');
    return result === 0; // Returns 0 if key already existed (already processed)
  }

  async setEmailWorkspace(emailId: string, teamId: string): Promise<void> {
    // Store with 90 day expiration (attachments may be accessed for a while)
    await this.redis.set(`email:workspace:${emailId}`, teamId);
    await this.redis.expire(`email:workspace:${emailId}`, 7776000); // 90 days
  }

  async getEmailWorkspace(emailId: string): Promise<string | null> {
    return await this.redis.get<string>(`email:workspace:${emailId}`);
  }
}

// Export singleton instance
// Use Redis if UPSTASH_REDIS_REST_URL is set, otherwise fall back to in-memory
export const threadStorage: ThreadStorage = (() => {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    console.log('[ThreadStorage] Using Redis for persistent storage');
    return new RedisThreadStorage(redisUrl, redisToken);
  }

  console.warn('[ThreadStorage] Using in-memory storage - thread mappings will be lost on restart!');
  console.warn('[ThreadStorage] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable Redis');
  return new InMemoryThreadStorage();
})();
