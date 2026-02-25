# @reactivebase/nextjs

ReactiveBase Next.js integration — SSR preloading and App Router support.

## Installation

```bash
npm install @reactivebase/nextjs @reactivebase/client @reactivebase/react
```

## Usage

```tsx
import { preloadQuery } from "@reactivebase/nextjs"

// Server Component
export default async function Page() {
  const tasks = await preloadQuery("listTasks")

  return <TaskList initialData={tasks} />
}
```

## Documentation

Full documentation is available at [reactivebase.dev/docs/nextjs](https://reactivebase.dev/docs/nextjs).

## License

MIT
