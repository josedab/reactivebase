# @reactivebase/react

ReactiveBase React hooks — `useQuery`, `useMutation`, `useAction` for reactive UIs.

## Installation

```bash
npm install @reactivebase/react @reactivebase/client
```

## Usage

```tsx
import { ReactiveBaseProvider, useQuery, useMutation } from "@reactivebase/react"
import { ReactiveBaseClient } from "@reactivebase/client"

const client = new ReactiveBaseClient({ url: "ws://localhost:4000" })

function App() {
  return (
    <ReactiveBaseProvider client={client}>
      <TaskList />
    </ReactiveBaseProvider>
  )
}

function TaskList() {
  const tasks = useQuery("listTasks")
  const createTask = useMutation("createTask")

  return (
    <ul>
      {tasks?.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  )
}
```

## Documentation

Full documentation is available at [reactivebase.dev/docs/react](https://reactivebase.dev/docs/react).

## License

MIT
