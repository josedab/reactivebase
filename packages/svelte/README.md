# @reactivebase/svelte

ReactiveBase Svelte stores — reactive query subscriptions for Svelte applications.

## Installation

```bash
npm install @reactivebase/svelte @reactivebase/client
```

## Usage

```svelte
<script>
  import { queryStore, mutationStore } from "@reactivebase/svelte"

  const tasks = queryStore("listTasks")
  const createTask = mutationStore("createTask")
</script>

<ul>
  {#each $tasks as task}
    <li>{task.title}</li>
  {/each}
</ul>
```

## Documentation

Full documentation is available at [reactivebase.dev/docs/svelte](https://reactivebase.dev/docs/svelte).

## License

MIT
