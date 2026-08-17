export function parseQuestionSource(source: string): unknown[] {
  const value = source.trim();
  if (!value) throw new Error("文件内容为空");
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const objects: unknown[] = [];
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
        if (depth < 0) throw new Error("JSON 大括号不匹配");
        if (depth === 0 && start >= 0) {
          objects.push(JSON.parse(value.slice(start, index + 1)) as unknown);
          start = -1;
        }
      }
    }
    if (!objects.length || depth !== 0 || inString) throw new Error("没有找到完整的 JSON 题目对象");
    return objects;
  }
}
