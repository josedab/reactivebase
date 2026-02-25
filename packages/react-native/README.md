# @reactivebase/react-native

ReactiveBase React Native SDK — offline-first reactive queries for mobile applications.

## Installation

```bash
npm install @reactivebase/react-native @reactivebase/client
```

## Usage

```tsx
import { ReactiveBaseProvider, useQuery } from "@reactivebase/react-native"
import { ReactiveBaseClient } from "@reactivebase/client"

const client = new ReactiveBaseClient({ url: "ws://api.example.com" })

export default function App() {
  return (
    <ReactiveBaseProvider client={client}>
      <TaskList />
    </ReactiveBaseProvider>
  )
}
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
