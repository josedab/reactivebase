#!/bin/bash

# Video Recording Terminal Script
# Run each section while screen recording.
# Pause between sections for narration.

clear
echo "╔════════════════════════════════════════════╗"
echo "║  ReactiveBase — Video 1: Quickstart (3min) ║"
echo "╚════════════════════════════════════════════╝"
echo ""
read -p "Press Enter to start..."

# Section 1: Create project
clear
echo "# Step 1: Create a new ReactiveBase project"
echo ""
echo "$ npx create-reactivebase my-app --yes"
sleep 2
# npx create-reactivebase my-app --yes

read -p "Press Enter for next section..."

# Section 2: Show project structure
clear
echo "# Step 2: Project structure"
echo ""
echo "$ tree my-app"
echo "my-app/"
echo "├── convex/"
echo "│   ├── schema.ts     ← Data model"
echo "│   └── tasks.ts      ← Queries & mutations"
echo "├── server.ts          ← Server entry"
echo "├── package.json"
echo "└── tsconfig.json"
sleep 3

read -p "Press Enter for next section..."

# Section 3: Show schema
clear
echo "# Step 3: Schema — one source of truth"
echo ""
cat << 'SCHEMA'
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
  }),
})
SCHEMA
sleep 4

read -p "Press Enter for next section..."

# Section 4: Show query
clear
echo "# Step 4: Reactive query — clients auto-update"
echo ""
cat << 'QUERY'
export const listTasks = query(async (ctx, { userId }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})
QUERY
echo ""
echo "☝️ Every client subscribed to this query gets"
echo "   automatic updates when tasks change."
sleep 4

read -p "Press Enter for next section..."

# Section 5: React component
clear
echo "# Step 5: React — three hooks, that's the entire API"
echo ""
cat << 'REACT'
function TaskList({ userId }) {
  const tasks = useQuery("tasks.list", { userId })
  const complete = useMutation("tasks.complete")

  return tasks?.map(task => (
    <li key={task.id}>
      {task.title}
      <button onClick={() => complete({ taskId: task.id })}>
        Done
      </button>
    </li>
  ))
}
REACT
sleep 4

echo ""
echo "🎬 End of Video 1"
echo ""
echo "Links:"
echo "  Docs:       https://reactivebase.dev"
echo "  GitHub:     https://github.com/reactivebase/reactivebase"
echo "  Playground: https://reactivebase.dev/play"
