/**
 * Redis Thread Storage Diagnostic Tool
 *
 * Tests Redis connection and shows all stored thread mappings.
 *
 * Usage:
 *   pnpm tsx scripts/test-redis.ts
 */

import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.error('❌ Missing Redis credentials!');
  console.error('Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your .env file');
  console.error('\nGet these from: https://console.upstash.com/');
  process.exit(1);
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

async function testRedis() {
  console.log('🔍 Testing Redis connection...\n');

  try {
    // Test connection with a ping
    const pingResult = await redis.ping();
    console.log('✅ Redis connection successful:', pingResult);

    // Get all keys
    console.log('\n📊 Fetching all thread storage keys...\n');

    const allKeys = await redis.keys('*');

    if (allKeys.length === 0) {
      console.log('ℹ️  No keys found in Redis. This is normal if no emails have been processed yet.\n');
      return;
    }

    console.log(`Found ${allKeys.length} keys:\n`);

    // Group keys by type
    const inboundKeys = allKeys.filter((k) => k.startsWith('inbound:'));
    const slackKeys = allKeys.filter((k) => k.startsWith('slack:'));
    const emailKeys = allKeys.filter((k) => k.startsWith('email:'));
    const slackmsgKeys = allKeys.filter((k) => k.startsWith('slackmsg:'));

    // Display thread mappings
    if (inboundKeys.length > 0) {
      console.log('📧 Inbound Thread Mappings:');
      console.log('─'.repeat(80));
      for (const key of inboundKeys) {
        const data = await redis.get<string>(key);
        const parsed = data ? JSON.parse(data) : null;
        console.log(`  ${key}`);
        if (parsed) {
          console.log(`    → Slack Thread: ${parsed.slackThreadTs}`);
          console.log(`    → Email ID: ${parsed.emailId}`);
        }
        console.log();
      }
    }

    if (slackKeys.length > 0) {
      console.log('\n💬 Slack Thread Mappings:');
      console.log('─'.repeat(80));
      for (const key of slackKeys) {
        const inboundThreadId = await redis.get<string>(key);
        console.log(`  ${key} → ${inboundThreadId}`);
      }
    }

    if (emailKeys.length > 0) {
      console.log(`\n📬 Processed Emails: ${emailKeys.length}`);
      console.log('─'.repeat(80));
      for (const key of emailKeys) {
        console.log(`  ${key}`);
      }
    }

    if (slackmsgKeys.length > 0) {
      console.log(`\n💌 Processed Slack Messages: ${slackmsgKeys.length}`);
      console.log('─'.repeat(80));
      for (const key of slackmsgKeys) {
        console.log(`  ${key}`);
      }
    }

    // Summary
    console.log('\n📈 Summary:');
    console.log('─'.repeat(80));
    console.log(`  Thread Mappings (inbound): ${inboundKeys.length}`);
    console.log(`  Thread Mappings (slack): ${slackKeys.length}`);
    console.log(`  Processed Emails: ${emailKeys.length}`);
    console.log(`  Processed Slack Messages: ${slackmsgKeys.length}`);
    console.log(`  Total Keys: ${allKeys.length}`);
  } catch (error) {
    console.error('❌ Error testing Redis:', error);
    process.exit(1);
  }
}

// Run the diagnostic
testRedis()
  .then(() => {
    console.log('\n✅ Diagnostic complete!\n');
  })
  .catch((error) => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });
