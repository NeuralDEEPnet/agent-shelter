# Backend Guidelines

Complete backend development guide for Adaptive applications using Typed-RPC.

> **For database operations:** See the [Database](./database.md) documentation for Prisma ORM setup, schema design, and migrations.

## Overview

Your backend is built with:

- **Typed-RPC**: Automatically type-safe client-server communication
- **Hono**: Fast, lightweight web framework
- **SuperJSON**: Serialization supporting Date, Map, Set, BigInt, etc.
- **Adaptive SDK**: Platform utilities for auth, AI, tasks, and more

## Creating Procedures

### Basic Procedures

Procedures are just exported async functions in `src/api/procedures.ts`:

```typescript
// src/api/procedures.ts

export async function health() {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  };
}

export async function getGreeting(name: string) {
  return `Hello, ${name}!`;
}

export async function createTask(data: {
  title: string;
  description?: string;
}) {
  // Your logic here
  return {
    id: "123",
    ...data,
    createdAt: new Date(),
  };
}
```

### Type Safety

Type inference is automatic. The frontend knows your backend types:

```typescript
// Frontend automatically knows:
// - Function names
// - Parameter types
// - Return types
// - No manual type definitions needed!

const result = await client.getGreeting("World");
// result is typed as string

const task = await client.createTask({
  title: "My Task",
  description: "Optional description",
});
// task is typed as { id: string; title: string; description?: string; createdAt: Date }
```

### Supported Types

SuperJSON handles types that regular JSON cannot:

```typescript
export async function getComplexData() {
  return {
    created: new Date(), // ✅ Date objects
    map: new Map([["key", "value"]]), // ✅ Maps
    set: new Set([1, 2, 3]), // ✅ Sets
    bigInt: BigInt(123), // ✅ BigInt
    undefined: undefined, // ✅ undefined
    regex: /test/g, // ✅ Regular expressions
  };
}
```

## Private Functions

Functions not exported from `procedures.ts` are private and cannot be called from the frontend:

```typescript
// src/api/procedures.ts

// ❌ Private - not exported, frontend cannot call
async function validateEmail(email: string) {
  return email.includes("@");
}

// ✅ Public - exported, frontend can call
export async function registerUser(email: string) {
  // Use private function internally
  if (!validateEmail(email)) {
    throw new Error("Invalid email");
  }

  // Registration logic...
  return { success: true };
}
```

This pattern keeps internal logic secure and unexposed.

## Code Organization

### Extracting Utilities

Create helper files for complex logic:

```typescript
// src/lib/email.ts
export function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

// src/api/procedures.ts
import { validateEmail, normalizeEmail } from "@/lib/email";

export async function registerUser(email: string) {
  const normalized = normalizeEmail(email);

  if (!validateEmail(normalized)) {
    throw new Error("Invalid email");
  }

  // Continue with registration...
}
```

### Composing Procedures

Break complex operations into smaller functions:

```typescript
// src/api/procedures.ts

// Private helpers
async function fetchUserData(userId: string) {
  // Database query
}

async function enrichUserProfile(data: any) {
  // Add computed fields
}

// Public procedure that composes helpers
export async function getUserProfile(userId: string) {
  const userData = await fetchUserData(userId);
  const enriched = await enrichUserProfile(userData);
  return enriched;
}
```

## Error Handling

### Throwing Errors

Errors automatically propagate to the frontend:

```typescript
export async function deleteTask(taskId: string) {
  const auth = await getAuth({ required: true });

  const task = await db.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  if (task.userId !== auth.userId) {
    throw new Error("Not authorized to delete this task");
  }

  await db.task.delete({
    where: { id: taskId },
  });

  return { success: true };
}
```

### Frontend Error Handling

```typescript
// Frontend
const mutation = useMutation({
  mutationFn: (taskId: string) => client.deleteTask(taskId),
  onSuccess: () => {
    toast.success("Task deleted");
  },
  onError: (error) => {
    toast.error(error.message); // "Task not found" or "Not authorized..."
  },
});
```

## Authentication

Use `getAuth` from the SDK to check authentication:

```typescript
import { getAuth } from "@adaptive-ai/sdk/server";

// Optional auth - check if user is logged in
export async function getPublicData() {
  const auth = await getAuth();

  if (auth.status === "authenticated") {
    // Return personalized data
    return { userId: auth.userId, data: "personalized" };
  }

  // Return public data
  return { userId: null, data: "public" };
}

// Required auth - throws if not logged in
export async function getPrivateData() {
  const auth = await getAuth({ required: true });

  // auth.userId is guaranteed to exist
  return { userId: auth.userId, data: "private" };
}
```

**Important**: When using `{ required: true }`, the frontend automatically redirects unauthenticated users to sign in.

## Database Queries

Use Prisma for database operations:

```typescript
import { db } from "@/api/db";
import { getAuth } from "@adaptive-ai/sdk/server";

export async function listMyTasks() {
  const auth = await getAuth({ required: true });

  return await db.task.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createTask(data: { title: string }) {
  const auth = await getAuth({ required: true });

  const task = await db.task.create({
    data: {
      userId: auth.userId,
      title: data.title,
    },
  });

  return task;
}
```

See [Database](./database.md) for complete Prisma documentation.

## Environment Variables

Access environment variables with the `env` helper:

```typescript
import { env } from "@/lib/env";

export async function sendNotification(message: string) {
  const apiKey = env.NOTIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error("NOTIFICATION_API_KEY not configured");
  }

  // Use the API key...
}
```

For validation, use `src/env.ts`. See [Environment Variables](/llms/env.md). Do not put environment variables directly in `app.config.json`.

## SDK Functions

The Adaptive SDK provides platform utilities:

```typescript
import { getAuth, mcp } from "@adaptive-ai/sdk/server";

export async function analyzeImage(imagePath: string) {
  const auth = await getAuth({ required: true });

  const { response } = await mcp.promptAgent({
    message: `Analyze this image: ${imagePath}`,
    outputJsonSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["description", "tags"],
    },
  });

  return response as { description: string; tags: string[] };
}
```

See documentation for:

- [Authentication](/llms/auth/index.md) - `getAuth`
- [AI Agents](/llms/ai.md) - `promptAgent`
- [Sending Email](/llms/email-sending.md) - `sendEmail`

## Best Practices

### 1. Keep Procedures Focused

Each procedure should do one thing:

```typescript
// ✅ Good - single responsibility
export async function createTask(data: TaskInput) {}
export async function updateTask(id: string, data: TaskInput) {}
export async function deleteTask(id: string) {}

// ❌ Bad - doing too much
export async function manageTask(
  action: "create" | "update" | "delete",
  data: any,
) {}
```

### 2. Validate Input

Use Zod for runtime validation:

```typescript
import { z } from "zod";

const taskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional(),
  dueDate: z.date().optional(),
});

export async function createTask(data: unknown) {
  // Validate at runtime
  const validated = taskSchema.parse(data);

  // Now validated is type-safe
  return { id: "123", ...validated };
}
```

### 3. Return Simple Objects

Return plain objects, not class instances:

```typescript
// ✅ Good - plain object
export async function getTask(id: string) {
  return {
    id,
    title: "My Task",
    createdAt: new Date(),
  };
}

// ❌ Bad - class instance
class Task {
  constructor(
    public id: string,
    public title: string,
  ) {}
  someMethod() {}
}

export async function getTask(id: string) {
  return new Task(id, "My Task"); // Methods won't serialize
}
```

### 4. Use Private Functions

Don't expose internal logic:

```typescript
// Private - internal use only
async function calculateDiscount(userId: string) {
  // Complex pricing logic
}

// Public - safe to expose
export async function getPrice(productId: string) {
  const auth = await getAuth();
  const basePrice = 100;

  if (auth.status === "authenticated") {
    const discount = await calculateDiscount(auth.userId);
    return basePrice - discount;
  }

  return basePrice;
}
```

### 5. Handle Errors Gracefully

Provide helpful error messages:

```typescript
export async function updateTask(id: string, data: TaskInput) {
  const auth = await getAuth({ required: true });

  const task = await db.task.findUnique({
    where: { id },
  });

  if (!task) {
    throw new Error(`Task with ID ${id} not found`);
  }

  if (task.userId !== auth.userId) {
    throw new Error("You do not have permission to update this task");
  }

  // Update logic...
}
```

## Server Configuration

The server setup in `src/api/server.ts` is managed for you. It:

- Runs on `PORT + 1` automatically
- Handles RPC requests at `/api/*`
- Manages request context with `runWithContext`
- Uses SuperJSON for serialization

**Don't edit `src/api/server.ts`** unless you have specific advanced requirements.

## Key Points

- **Simple exports**: Just export async functions from `procedures.ts`
- **Automatic types**: Frontend knows all your types automatically
- **Private by default**: Only exported functions are callable
- **Error propagation**: Thrown errors appear on frontend automatically
- **Rich types**: SuperJSON handles Date, Map, Set, BigInt, undefined, etc.
- **SDK integration**: Use `getAuth`, `promptAgent`, and other SDK functions
- **Organization**: Extract complex logic to separate files in `src/lib/`
