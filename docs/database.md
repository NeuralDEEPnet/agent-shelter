# Database

The Adaptive platform uses SQLite with Prisma ORM for type-safe database access.

## ORM

We use [Prisma](https://www.prisma.io/) as the ORM for database interactions. Prisma provides a type-safe query builder and migration system.

Specific packages used can be found in `package.json`:

- `@prisma/client`
- `@prisma/adapter-better-sqlite3`

## Schema Definition

Define your data models in `schema.prisma`:

```prisma
model User {
  // Adaptive AI platform columns (do not change)
  id     String  @id
  name   String?
  image  String?
  handle String?

  // Add your custom columns here
  email     String?  @unique
  createdAt DateTime @default(now())
  posts     Post[]
}
```

## Database Client

The database client is initialized in `src/api/db.ts`. Import and use this `db` instance in your procedures:

```typescript
import { db } from "@/api/db";

export async function getUsers() {
  return await db.user.findMany();
}
```

## Migrations

Migrations are automatically created and applied when you run `npm run dev`. The migration name is set to "auto".

If you need to manually create a migration after modifying your `schema.prisma` file:

```bash
npm run dev:migrations
```

For production:

```bash
npm run prod:migrations
```

## Documentation

For detailed information about Prisma features, queries, and best practices, see the official documentation:

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
