# Frontend Guidelines

Complete frontend development guidelines for Adaptive applications.

> **Before building your UI:** Read the [Design System](./design.md) documentation to understand responsive patterns, dark mode, component usage, and UX best practices.

## Data Fetching

Always use React Query with the typed RPC `client` for API requests:

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => client.listTasks(),
  });

  const mutation = useMutation({
    mutationFn: (data) => client.createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
```

**Important**: Never use `axios`, `fetch`, or `XMLHttpRequest` directly when interacting with the API - always use the typed `client`.

## Mutations vs Queries

### Use `useMutation` for:

- Operations triggered by explicit user actions
- Costly operations (e.g., `requestMultimodalModel`)
- Operations with side effects
- Actions requiring tight control

```tsx
const createMutation = useMutation({
  mutationFn: (data) => client.createTask(data),
});

<Button onClick={() => createMutation.mutate({ title: "New Task" })}>
  Create
</Button>;
```

### Important Rules:

- **Avoid triggering mutations in `useEffect`** - extremely risky, can trigger multiple times
- Execute operations where they happen (e.g., on button click)
- Only navigate after operation completes
- Each mutation executes only as many times as user triggers it

## Optimistic Updates

```tsx
const mutation = useMutation({
  mutationFn: (data) => client.createTask(data),
  onMutate: async (newTask) => {
    await queryClient.cancelQueries({ queryKey: ["tasks"] });

    const previousTasks = queryClient.getQueryData<Task[]>(["tasks"]);

    queryClient.setQueryData<Task[]>(["tasks"], (old) => [
      ...(old ?? []),
      { id: "temp-id", ...newTask },
    ]);

    return { previousTasks };
  },
  onError: (err, newTask, context) => {
    queryClient.setQueryData(["tasks"], context?.previousTasks);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  },
});
```

## Loading States

### Initial Loading

```tsx
const { data, isPending, isFetched, isFetching } = useQuery({
  queryKey: ["tasks"],
  queryFn: () => client.listTasks(),
});

if (isPending) {
  return <Skeleton />; // Show skeleton, not empty state
}

// Only show "no items" when actually empty
if (isFetched && !isFetching && (!data || data.length === 0)) {
  return <div>No tasks found</div>;
}

// During refetch, show existing data with subtle indicator
return (
  <div>
    {isFetching && <RefreshIndicator />}
    {data?.map((task) => (
      <TaskItem key={task.id} task={task} />
    ))}
  </div>
);
```

**Note**: React Query v5 uses `isPending` instead of `isLoading` for initial load state

### Mutation Loading

```tsx
const mutation = useMutation({
  mutationFn: (data) => client.createTask(data),
});

<Button
  disabled={mutation.isPending}
  onClick={() => mutation.mutate({ title: "New Task" })}
>
  {mutation.isPending ? "Creating..." : "Create Task"}
</Button>;
```

## File Handling

```tsx
import { toast } from "sonner";

function FileUpload() {
  const [file, setFile] = useState<File>();
  const mutation = useMutation({
    mutationFn: (data) => client.uploadFile(data),
  });

  const handleUpload = async () => {
    if (!file) return;

    // Check size limit
    const UPLOAD_LIMIT_MB = 50;
    if (file.size > UPLOAD_LIMIT_MB * 1024 * 1024) {
      toast.error("File too large");
      return;
    }

    // Convert file to base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    try {
      const base64 = await base64Promise;
      mutation.mutate({
        name: file.name,
        base64,
      });
    } catch (error) {
      toast.error("Failed to read file");
    }
  };

  return (
    <>
      <input
        type="file"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0])}
      />
      <Button onClick={handleUpload} disabled={mutation.isPending}>
        {mutation.isPending ? "Uploading..." : "Upload"}
      </Button>
    </>
  );
}
```

## Debouncing

```tsx
import { debounce } from "lodash";
import { useCallback, useState } from "react";

function SearchInput({
  onSearch,
}: {
  onSearch: (value: string) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState("");

  const debouncedSearch = useCallback(
    debounce((value: string) => {
      onSearch(value);
    }, 500),
    [onSearch],
  );

  return (
    <Input
      value={localValue}
      onChange={(e) => {
        setLocalValue(e.target.value); // Immediate UI update
        debouncedSearch(e.target.value); // Debounced API call
      }}
    />
  );
}
```

## Routing

Use React Router for navigation:

```tsx
import {
  BrowserRouter as Router,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
      </Routes>
    </Router>
  );
}
```

## Key Points

- **Typed RPC client**: Always use `client` from `@/lib/client`, never axios, fetch, or XMLHttpRequest
- **No mutations in useEffect**: Only trigger on user actions
- **React Query v5**: Use `isPending` instead of `isLoading`, use object syntax for hooks
- **Loading states**: Show skeletons, not empty states during initial load
- **Optimistic updates**: Improve perceived performance
- **File uploads**: Use base64 encoding with FileReader
- **Toasts**: Use `sonner` library with `toast.success()` and `toast.error()`
- **Debouncing**: For search and auto-save
