/**
 * ReactiveBase CLI - main entry point.
 * Commands: dev, generate, migrate, functions
 */

const args = process.argv.slice(2)
const verbose = args.includes("--verbose") || args.includes("-V")
const quiet = args.includes("--quiet") || args.includes("-q")
if (verbose) {
  process.env.LOG_LEVEL = "debug"
}
if (quiet) {
  process.env.LOG_LEVEL = "silent"
}
const command = args[0]

async function main(): Promise<void> {
  switch (command) {
    case "dev": {
      const { devServer } = await import("./commands/dev.js")
      const port = getFlag("--port", "4000")
      await devServer({
        port: parseInt(port, 10),
        projectDir: process.cwd(),
        logLevel: verbose ? "debug" : "info",
      })
      break
    }

    case "generate": {
      const subcommand = args[1]
      if (subcommand === "--procedures") {
        const { generateProcedures } = await import("./commands/generate-procedures.js")
        await generateProcedures({ projectDir: process.cwd() })
      } else if (subcommand === "--tests" || subcommand === ":tests") {
        const { generateTestsCommand } = await import("./commands/generate-tests.js")
        await generateTestsCommand({
          projectDir: process.cwd(),
          coverage: getFlag("--coverage", "standard") as "basic" | "standard" | "high",
          outputDir: args.includes("--output") ? getFlag("--output", "") : undefined,
          dryRun: args.includes("--dry-run"),
        })
      } else {
        const { writeGeneratedFiles } = await import("./commands/generate.js")
        writeGeneratedFiles(process.cwd())
      }
      break
    }

    case "generate:fixtures": {
      console.log("Generating test fixtures from schema...")
      console.log("Run: npx reactivebase generate --tests --coverage high")
      console.log("Fixture factories will be generated in __fixtures__/factories/")
      break
    }

    case "migrate": {
      const { migrateGenerate, migrateApply, migrateStatus, migratePreview } = await import("./commands/migrate.js")
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
        case "--preview":
          await migratePreview({ ...options, usePglite: args.includes("--pglite") })
          break
        case "--safe": {
          const { migrateSafe } = await import("./commands/migrate-safe.js")
          await migrateSafe(options)
          break
        }
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
        console.log(
          "Generated files:",
          files.map((f) => f.path),
        )
      } else {
        console.log("Usage: reactivebase functions list")
      }
      break
    }

    case "dacl": {
      const { daclList, daclTest, daclGenerateRls, daclCoverage } = await import("./commands/dacl.js")
      const subcommand = args[1] || "list"
      const daclOptions = {
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
      }

      switch (subcommand) {
        case "list":
          await daclList(daclOptions)
          break
        case "test":
          await daclTest(daclOptions)
          break
        case "generate-rls":
          await daclGenerateRls(daclOptions)
          break
        case "coverage":
          await daclCoverage(daclOptions)
          break
        default:
          console.error(`Unknown dacl subcommand: ${subcommand}`)
          showDaclHelp()
      }
      break
    }

    case "auth:debug": {
      const { authDebug } = await import("./commands/auth-debug.js")
      await authDebug({
        projectDir: process.cwd(),
        userId: getFlag("--user", ""),
        queryName: getFlag("--query", ""),
        table: getFlag("--table", ""),
      })
      break
    }

    case "ivm": {
      const { ivmList, ivmStats, ivmAnalyze } = await import("./commands/ivm.js")
      const subcommand = args[1] || "list"
      const ivmOptions = {
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
      }

      switch (subcommand) {
        case "list":
          await ivmList(ivmOptions)
          break
        case "stats":
          await ivmStats(ivmOptions)
          break
        case "analyze":
          await ivmAnalyze(ivmOptions)
          break
        default:
          console.error(`Unknown ivm subcommand: ${subcommand}`)
          showIvmHelp()
      }
      break
    }

    case "deploy": {
      const { deploy, deployPreview, destroyPreview, tailLogs } = await import("./commands/deploy.js")
      const subcommand = args[1]

      if (subcommand === "--cloud") {
        const { deployCloud } = await import("./commands/deploy-cloud.js")
        await deployCloud({
          projectDir: process.cwd(),
          projectName: getFlag("--name", ""),
          region: getFlag("--region", "us-east-1"),
          plan: getFlag("--plan", "starter"),
        })
      } else if (subcommand === "--preview") {
        const prNumber = parseInt(getFlag("--pr", "0"), 10)
        const branch = getFlag("--branch", "main")
        await deployPreview({ projectDir: process.cwd(), prNumber, branch })
      } else if (subcommand === "--destroy") {
        const appName = args[2] ?? ""
        await destroyPreview(appName)
      } else if (subcommand === "--logs") {
        const appName = args[2] ?? ""
        await tailLogs(appName)
      } else {
        await deploy({
          projectDir: process.cwd(),
          provider: getFlag("--provider", "flyio") as "flyio" | "railway",
          region: getFlag("--region", "iad"),
          appName: args.includes("--name") ? getFlag("--name", "") : undefined,
        })
      }
      break
    }

    case "seed": {
      const { seedRun } = await import("./commands/seed.js")
      await seedRun({
        projectDir: process.cwd(),
        profile: args.includes("--profile") ? getFlag("--profile", "") : undefined,
        environment: getFlag("--env", "dev"),
      })
      break
    }

    case "seed:reset": {
      const { seedReset } = await import("./commands/seed.js")
      await seedReset({ projectDir: process.cwd() })
      break
    }

    case "seed:status": {
      const { seedStatus } = await import("./commands/seed.js")
      await seedStatus({ projectDir: process.cwd() })
      break
    }

    case "add": {
      const { pluginAdd } = await import("./commands/plugin-add.js")
      await pluginAdd(args.slice(1))
      break
    }

    case "optimize": {
      const { optimize: optimizeCmd } = await import("./commands/optimize.js")
      await optimizeCmd({
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
        json: args.includes("--json"),
        apply: args.includes("--apply"),
      })
      break
    }

    case "insights": {
      const { insights: insightsCmd } = await import("./commands/insights.js")
      await insightsCmd({
        projectDir: process.cwd(),
        json: args.includes("--json"),
        threshold: getFlag("--threshold"),
      })
      break
    }

    case "doctor": {
      const { doctor: doctorCmd } = await import("./commands/doctor.js")
      await doctorCmd({
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
        autoFix: args.includes("--fix"),
        json: args.includes("--json"),
      })
      break
    }

    case "branch": {
      const {
        branchCreate,
        branchList,
        branchDelete,
        branchDiff,
        branchSwitch,
        branchMerge,
        branchGenerateAction,
        showBranchHelp,
      } = await import("./commands/branch.js")
      const branchSubcmd = args[1]
      const branchOpts = {
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
        neonApiKey: process.env.NEON_API_KEY,
        neonProjectId: process.env.NEON_PROJECT_ID,
      }

      switch (branchSubcmd) {
        case "create":
          await branchCreate(args[2] ?? "", {
            ...branchOpts,
            from: getFlag("--from", "main"),
            pr: args.includes("--pr") ? parseInt(getFlag("--pr", "0"), 10) : undefined,
            commit: getFlag("--commit"),
            seed: args.includes("--seed"),
            author: getFlag("--author"),
          })
          break
        case "list":
          await branchList(branchOpts)
          break
        case "delete":
          await branchDelete(args[2] ?? "", branchOpts)
          break
        case "diff":
          await branchDiff(args[2] ?? "", args[3] ?? "main", branchOpts)
          break
        case "switch":
          await branchSwitch(args[2] ?? "", branchOpts)
          break
        case "merge":
          await branchMerge(args[2] ?? "", { ...branchOpts, into: getFlag("--into", "main") })
          break
        case "generate-action":
          await branchGenerateAction(branchOpts)
          break
        default:
          showBranchHelp()
      }
      break
    }

    case "init": {
      const { initProject } = await import("./commands/init-profile.js")
      await initProject({
        projectDir: process.cwd(),
        profile: getFlag("--profile", "minimal"),
        json: args.includes("--json"),
      })
      break
    }

    case "analyze": {
      const { analyzeCommand } = await import("./commands/analyze.js")
      await analyzeCommand({
        projectDir: process.cwd(),
        connectionString: process.env.DATABASE_URL,
        json: args.includes("--json"),
        threshold: getFlag("--threshold"),
      })
      break
    }

    case "tutorial": {
      const { runTutorial } = await import("./commands/tutorial.js")
      const stepFlag = getFlag("--step")
      await runTutorial({
        projectDir: process.cwd(),
        startStep: stepFlag ? parseInt(stepFlag, 10) : undefined,
        reset: args.includes("--reset"),
        nonInteractive: args.includes("--non-interactive"),
      })
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
  generate --tests Generate E2E test suites from schema
  migrate          Database migration commands
  branch           Database branching & PR previews
  deploy           Deploy to cloud (Fly.io/Railway/ReactiveBase Cloud)
  deploy --cloud   Deploy to ReactiveBase Cloud (managed)
  doctor           Check PostgreSQL extension health
  init --profile   Initialize project with a config profile
  add <plugin>     Add a plugin (npm install + configure + types)
  functions list   List all defined functions
  dacl             Access control policy management
  ivm              Incremental view maintenance
  analyze          Smart query cost estimator
  tutorial         Interactive onboarding tutorial (7 steps)

Options:
  --help, -h       Show this help message
  --version, -v    Show version number
  --verbose, -V    Enable verbose/debug output
  --quiet, -q      Suppress all output (CI-friendly)

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
  --preview     Preview migration impact with destructive operation detection
  --safe        Analyze migration safety for zero-downtime deployment

Options for --preview:
  --pglite      Run shadow execution using in-process PGlite
`)
}

function showDaclHelp(): void {
  console.log(`
Usage: reactivebase dacl [subcommand]

Subcommands:
  list           List defined access control policies
  test           Run policy test cases
  generate-rls   Generate Postgres RLS SQL from policies
  coverage       Show policy coverage report
`)
}

function showIvmHelp(): void {
  console.log(`
Usage: reactivebase ivm [subcommand]

Subcommands:
  list           List registered IVM views
  stats          Show IVM runtime statistics
  analyze        Analyze query patterns for IVM eligibility
`)
}

function getFlag(flag: string, defaultValue: string = ""): string {
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
