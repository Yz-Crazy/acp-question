import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/questions-to-sql.mjs <questions.json|md> <output.sql>");
  process.exit(1);
}

const source = readFileSync(inputPath, "utf8").trim();

function parseSource(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const objects = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) objects.push(JSON.parse(value.slice(start, index + 1)));
      }
    }
    if (!objects.length || depth !== 0) throw new Error("No complete JSON question objects found");
    return objects;
  }
}

const sqlString = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const questions = parseSource(source);
const rows = questions.map((item, index) => {
  const type = item.t === "多选题" || item.t === "multiple" ? "multiple" : "single";
  const sourceId = Number.isInteger(item.i) ? String(item.i) : "NULL";
  const id = Number.isInteger(item.i) ? `source-${item.i}` : `import-${index + 1}`;
  return `(${sqlString(id)}, ${sourceId}, ${sqlString(type)}, ${sqlString(item.q)}, ${sqlString(JSON.stringify(item.o ?? {}))}, ${sqlString(JSON.stringify(item.a ?? []))}, ${sqlString(item.e)}, ${sqlString(item.k || "未分类")}, ${item.core ? 1 : 0}, ${item.r ? sqlString(item.r) : "NULL"})`;
});

const sql = `-- Generated from ${basename(inputPath)}\nINSERT INTO questions (id, source_id, type, question, options_json, answer_json, explanation, category, is_core, reference_url)\nVALUES\n${rows.join(",\n")}\nON CONFLICT(id) DO UPDATE SET\n  source_id = excluded.source_id,\n  type = excluded.type,\n  question = excluded.question,\n  options_json = excluded.options_json,\n  answer_json = excluded.answer_json,\n  explanation = excluded.explanation,\n  category = excluded.category,\n  is_core = excluded.is_core,\n  reference_url = excluded.reference_url,\n  active = 1,\n  updated_at = datetime('now');\n`;

writeFileSync(outputPath, sql);
console.log(`Wrote ${questions.length} questions to ${outputPath}`);
