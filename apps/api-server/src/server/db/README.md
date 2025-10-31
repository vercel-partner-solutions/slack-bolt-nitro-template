# Database Setup with Drizzle ORM

This project uses [Drizzle ORM](https://orm.drizzle.team/) with NeonDB (PostgreSQL).

**Note:** The actual database schema is now in the shared `packages/db/` package to ensure consistency across all apps.

## Configuration

Set the `DATABASE_URL` environment variable in the **monorepo root** `.env` file:

```bash
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

Get your connection string from [Neon Console](https://console.neon.tech/).

## Directory Structure

- `src/server/db/index.ts` - Database client initialization
- `drizzle.config.ts` - Drizzle Kit configuration (points to shared schema)
- `drizzle/` - Generated migrations (auto-generated, git-ignored)

**Shared Schema Location:**
- `packages/db/src/schema/` - All database schema definitions (monorepo root)

## Creating Schemas

All schemas should be created in the shared package at `packages/db/src/schema/`:

1. Create a new schema file in `packages/db/src/schema/`:

```typescript
// packages/db/src/schema/users.ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

2. Export it in `packages/db/src/schema/index.ts`:

```typescript
export * from "./users";
```

3. The schema is automatically available to all apps via the `@slackbound/db` package.

## Available Commands

### Generate Migrations

Generate SQL migration files from your schema:

```bash
pnpm db:generate
```

### Push Schema to Database

Push schema changes directly to the database (dev only):

```bash
pnpm db:push
```

### Run Migrations

Apply migrations to the database:

```bash
pnpm db:migrate
```

### Drizzle Studio

Open a visual database browser:

```bash
pnpm db:studio
```

## Usage in Code

Import the database client from this app and schemas from the shared package:

```typescript
// Database client (app-specific connection)
import { db } from "~/server/db";

// Schemas (from shared package)
import { user, userConfig, waitlist } from "@slackbound/db";
import { eq } from "drizzle-orm";

// Query
const allUsers = await db.select().from(user);

// Insert
const newUser = await db.insert(user).values({
  id: "user_123",
  name: "John Doe",
  email: "user@example.com",
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}).returning();

// Update
await db.update(user)
  .set({ name: "Jane Doe" })
  .where(eq(user.id, "user_123"));

// Delete
await db.delete(user).where(eq(user.id, "user_123"));
```

## Best Practices

1. **Always generate migrations**: Use `pnpm db:generate` before deploying
2. **Use transactions**: Wrap multiple operations in transactions for data consistency
3. **Type safety**: Drizzle provides full TypeScript type inference
4. **Indexes**: Add indexes to frequently queried columns
5. **Timestamps**: Include `createdAt` and `updatedAt` fields for auditing

## Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Drizzle with Neon Guide](https://neon.tech/docs/guides/drizzle)
- [NeonDB Documentation](https://neon.tech/docs)

