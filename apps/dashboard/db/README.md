# Database Documentation

This directory contains the database connection setup for the SlackBound dashboard.

**Note:** The actual database schema is now in the shared `packages/db/` package to ensure consistency across all apps.

## Structure

```
db/
├── index.ts          # Database connection and Drizzle instance
└── README.md         # This file

packages/db/          # Shared schema (monorepo root)
├── src/
│   └── schema/       # All database schemas
└── drizzle.config.ts # Shared Drizzle configuration
```

## Database Setup

### 1. Configure Environment Variables

Add your Neon PostgreSQL connection string to the **monorepo root** `.env` file:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/database?sslmode=require
```

The `drizzle.config.ts` in this app automatically loads environment variables from the root `.env` file.

### 2. Generate and Push Schema

All database commands can be run from any app directory. They all reference the shared schema in `packages/db/`:

```bash
# Generate migration files from schema
bun run db:generate

# Push schema directly to database (recommended for development)
bun run db:push

# Open Drizzle Studio to view and manage your database
bun run db:studio
```

## Schema Overview

See the [shared database package README](../../../packages/db/README.md) for complete schema documentation.

### Key Tables

- **`user`, `session`, `account`, `verification`** - Better-Auth authentication tables
- **`userConfig`** - User-specific configuration for email sending
- **`waitlist`** - Waitlist email signups

## Using the Database

### Importing the Database and Schema

```typescript
// Database client (app-specific connection)
import { getDb } from "@/db";

// Schemas (from shared package)
import { waitlist, user, userConfig } from "@slackbound/db";
import { eq } from "drizzle-orm";

const db = getDb();
```

### Example Queries

```typescript
import { getDb } from "@/db";
import { waitlist } from "@slackbound/db";
import { eq } from "drizzle-orm";

const db = getDb();

// Insert a new waitlist entry
await db.insert(waitlist).values({
  email: "user@example.com",
});

// Query all waitlist entries
const entries = await db.select().from(waitlist);

// Find by email
const entry = await db
  .select()
  .from(waitlist)
  .where(eq(waitlist.email, "user@example.com"));
```

## Migration Workflow

### Development (Schema Push)

For rapid development, use `db:push` to sync schema changes directly:

```bash
bun run db:push
```

This is ideal for:
- Local development
- Iterating on schema design
- Testing changes quickly

### Production (Migrations)

For production deployments, use proper migrations:

```bash
# 1. Generate migration files from schema changes
bun run db:generate

# 2. Review generated SQL in drizzle/ directory

# 3. Apply migrations to database
bun run db:migrate
```

This approach:
- Creates versioned migration files
- Allows review before applying changes
- Maintains migration history
- Enables rollbacks if needed

## Best Practices

1. **Never commit `.env.local`** - It contains sensitive credentials
2. **Review generated migrations** before applying to production
3. **Use transactions** for related database operations
4. **Add indexes** for frequently queried columns
5. **Use typed queries** with Drizzle's query builder for type safety

## Troubleshooting

### Connection Issues

If you're having trouble connecting to Neon:
- Verify your `DATABASE_URL` is correct
- Check that SSL mode is enabled (`?sslmode=require`)
- Ensure your IP is allowed in Neon's network settings

### Schema Sync Issues

If your schema is out of sync:
```bash
# For development, force push schema
bun run db:push

# For production, generate and apply migrations
bun run db:generate
bun run db:migrate
```

### TypeScript Errors

If you're getting type errors:
- Restart your TypeScript server
- Check that schema exports are correct in `schema/index.ts`
- Verify Drizzle is using the latest schema

## Additional Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Neon PostgreSQL Documentation](https://neon.tech/docs/introduction)
- [Better-Auth Database Schema](https://www.better-auth.com/docs/concepts/database)

