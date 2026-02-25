# @reactivebase/edge

ReactiveBase edge runtime adapter — query prefetching for edge workers (Cloudflare Workers, Vercel Edge).

## Installation

```bash
npm install @reactivebase/edge
```

## Usage

```ts
import { createEdgeHandler } from "@reactivebase/edge"

export default createEdgeHandler({
  serverUrl: "https://api.example.com",
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
