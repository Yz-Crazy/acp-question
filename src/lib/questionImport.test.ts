import { describe, expect, it } from "vitest";
import { parseQuestionSource } from "./questionImport";

describe("parseQuestionSource", () => {
  it("parses arrays and single objects", () => {
    expect(parseQuestionSource('[{"i":1},{"i":2}]')).toHaveLength(2);
    expect(parseQuestionSource('{"i":1}')).toHaveLength(1);
  });

  it("parses consecutive objects in markdown", () => {
    const result = parseQuestionSource('题库\n```json\n{"i":1,"q":"a}b"}\n```\n{"i":2}');
    expect(result).toHaveLength(2);
  });

  it("rejects incomplete input", () => {
    expect(() => parseQuestionSource('{"i":1')).toThrow("完整");
  });
});
