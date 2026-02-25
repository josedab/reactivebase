# @reactivebase/vue

ReactiveBase Vue 3 composables — reactive query subscriptions for Vue applications.

## Installation

```bash
npm install @reactivebase/vue @reactivebase/client
```

## Usage

```vue
<script setup lang="ts">
import { useQuery, useMutation } from "@reactivebase/vue"

const tasks = useQuery("listTasks")
const createTask = useMutation("createTask")
</script>

<template>
  <ul>
    <li v-for="task in tasks" :key="task.id">{{ task.title }}</li>
  </ul>
</template>
```

## Documentation

Full documentation is available at [reactivebase.dev/docs/vue](https://reactivebase.dev/docs/vue).

## License

MIT
