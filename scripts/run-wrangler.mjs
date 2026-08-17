import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/run-wrangler.mjs <wrangler arguments>");
  process.exit(1);
}

const remote = args[0] === "deploy" || args[0] === "secret" || args.includes("--remote");
const configuredId = process.env.D1_DATABASE_ID?.trim();
const localId = "00000000-0000-0000-0000-000000000000";
const databaseId = configuredId || (remote ? "" : localId);

if (!databaseId) {
  console.error("Missing D1_DATABASE_ID. Set it in the deployment environment before running remote migrations or deploy.");
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId) && databaseId !== localId) {
  console.error("D1_DATABASE_ID must be a valid D1 database UUID.");
  process.exit(1);
}

const templatePath = join(process.cwd(), "wrangler.jsonc");
const generatedPath = join(process.cwd(), `.wrangler.generated.${process.pid}.jsonc`);
const placeholder = "${D1_DATABASE_ID}";
const template = readFileSync(templatePath, "utf8");
if (!template.includes(placeholder)) {
  console.error(`wrangler.jsonc must contain the ${placeholder} placeholder.`);
  process.exit(1);
}

const executable = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
writeFileSync(generatedPath, template.replaceAll(placeholder, databaseId));
try {
  const result = spawnSync(executable, [...args, "--config", generatedPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.signal) console.error(`Wrangler stopped by signal ${result.signal}.`);
  process.exitCode = result.status ?? 1;
} finally {
  if (existsSync(generatedPath)) unlinkSync(generatedPath);
}
