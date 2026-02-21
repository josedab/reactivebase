/**
 * ReactiveBase CLI - main entry point.
 * Commands: dev, generate, migrate, functions
 */

const args = process.argv.slice(2)
const command = args[0]

async function main(): Promise<void> {
  switch (command) {
    case "dev": {
      const { devServer } = await import("./commands/dev.js")
      const port = getFlag("--port", "4000")
      await devServer({
        port: parseInt(port, 10),
        projectDir: process.cwd(),
      })
      break
    }

    case "generate": {
      const { writeGeneratedFiles } = await import("./commands/generate.js")
      writeGeneratedFiles(process.cwd())
      break
    }

    case "migrate": {
      const { migrateGenerate, migrateApply, migrateStatus } = await import("./commands/migrate.js")
      const subcommand = args[1] || "--status"
      const options = {
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
      }

      switch (subcommand) {
        case "--generate":
          await migrateGenerate(options)
          break
        case "--apply":
          await migrateApply(options)
          break
        case "--status":
          await migrateStatus(options)
          break
        case "--rollback":
          console.log("Rollback not yet implemented.")
          break
        default:
          console.error(`Unknown migrate subcommand: ${subcommand}`)
          showMigrateHelp()
      }
      break
    }

    case "functions": {
      const subcommand = args[1]
      if (subcommand === "list") {
        console.log("Listing functions...")
        const { generateTypes } = await import("./commands/generate.js")
        const files = generateTypes(process.cwd())
        console.log("Generated files:", files.map((f) => f.path))
      } else {
        console.log("Usage: reactivebase functions list")
      }
      break
    }

    case "--help":
    case "-h":
    case undefined:
      showHelp()
      break

    case "--version":
    case "-v":
      console.log("reactivebase v0.1.0")
      break

    default:
      console.error(`Unknown command: ${command}`)
      showHelp()
      process.exit(1)
  }
}

function showHelp(): void {
  console.log(`
ReactiveBase CLI v0.1.0

Usage: reactivebase <command> [options]

Commands:
  dev              Start development server
  generate         Generate types from schema
  migrate          Database migration commands
  functions list   List all defined functions

Options:
  --help, -h       Show this help message
  --version, -v    Show version number

Migrate subcommands:
  --generate       Generate a new migration
  --apply          Apply pending migrations
  --status         Show migration status
  --rollback       Rollback last migration

Examples:
  reactivebase dev --port 4000
  reactivebase generate
  reactivebase migrate --generate
  reactivebase migrate --apply
`)
}

function showMigrateHelp(): void {
  console.log(`
Usage: reactivebase migrate [subcommand]

Subcommands:
  --generate    Generate a new migration from schema changes
  --apply       Apply pending migrations to the database
  --status      Show current migration status
  --rollback    Rollback the last applied migration
`)
}

function getFlag(flag: string, defaultValue: string): string {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1]
  }
  return defaultValue
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
