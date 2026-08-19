import { isAnswerCorrect, MOCK_EXAM_CATEGORY_QUOTAS, nextReviewDate, normalizeAnswers, normalizeQuestionType, scoreMockExam } from "../shared/quiz";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOOTSTRAP_TOKEN?: string;
}

interface User {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "member";
}

interface QuestionRow {
  id: string;
  source_id: number | null;
  type: "single" | "multiple";
  question: string;
  options_json: string;
  answer_json?: string;
  explanation?: string;
  category: string;
  is_core: number;
  reference_url?: string | null;
  attempt_count?: number | null;
  last_is_correct?: number | null;
  is_marked?: number | null;
  wrong_count?: number | null;
  next_review_at?: string | null;
}

interface MockSourceRow {
  source_question_id?: string | null;
  type: "single" | "multiple";
  question: string;
  options_json: string;
  answer_json: string;
  explanation: string;
  category: string;
  reference_url: string | null;
}

interface MockExamRow {
  id: string;
  title: string;
  source: "fixed" | "random";
  status: "in_progress" | "submitted";
  template_id: string | null;
  duration_seconds: number;
  remaining_seconds: number;
  current_item_id: string | null;
  current_section: "single" | "multiple";
  score: number | null;
  passed: number | null;
  wrong_count: number | null;
  started_at: string;
  updated_at: string;
  submitted_at: string | null;
}

interface MockExamItemRow extends MockSourceRow {
  id: string;
  position: number;
  selected_json: string | null;
  marked: number;
}

const MOCK_EXAM_CATEGORY_ALIASES: Record<string, readonly string[]> = {
  "大模型应用开发": ["大模型应用开发基础"],
  "多Agent及多模态应用": ["多agent及多模态应用"]
};

function mockCategoryAliases(category: string): string[] {
  return [category, ...(MOCK_EXAM_CATEGORY_ALIASES[category] ?? [])];
}

function canonicalMockCategory(category: string): string {
  const normalized = category.trim().toLowerCase();
  return MOCK_EXAM_CATEGORY_QUOTAS.find((quota) => mockCategoryAliases(quota.category).some((alias) => alias.toLowerCase() === normalized))?.category ?? category.trim();
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const encoder = new TextEncoder();
const SESSION_COOKIE = "aq_session";
const SESSION_DAYS = 30;
const PASSWORD_HASH_ITERATIONS = 100_000;

function apiJson(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiError(415, "请求格式必须是 JSON");
  try {
    return await request.json<T>();
  } catch {
    throw new ApiError(400, "请求内容不是有效的 JSON");
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_DAYS * 86_400): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomToken(byteLength = 32): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: PASSWORD_HASH_ITERATIONS },
    key,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function getUser(request: Request, env: Env): Promise<User | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.disabled = 0`
  ).bind(tokenHash).first<User>();
}

async function requireUser(request: Request, env: Env): Promise<User> {
  const user = await getUser(request, env);
  if (!user) throw new ApiError(401, "登录状态已过期，请重新登录");
  return user;
}

async function createSession(request: Request, env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  ).bind(tokenHash, userId, `+${SESSION_DAYS} days`).run();
  return sessionCookie(request, token);
}

function validateUsername(usernameRaw: unknown): string {
  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  if (!/^[\p{L}\p{N}_-]{3,20}$/u.test(username)) throw new ApiError(400, "用户名需为 3-20 位文字、字母、数字、下划线或短横线");
  return username;
}

function validatePassword(passwordRaw: unknown): string {
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  if (password.length < 8 || password.length > 72) throw new ApiError(400, "密码长度需为 8-72 位");
  return password;
}

function validateNickname(nicknameRaw: unknown): string {
  const nickname = typeof nicknameRaw === "string" ? nicknameRaw.trim() : "";
  const length = Array.from(nickname).length;
  if (length < 1 || length > 30 || /[\u0000-\u001f\u007f]/.test(nickname)) {
    throw new ApiError(400, "昵称需为 1-30 个字符且不能包含控制字符");
  }
  return nickname;
}

function validateCredentials(usernameRaw: unknown, passwordRaw: unknown): { username: string; password: string } {
  const username = validateUsername(usernameRaw);
  const password = validatePassword(passwordRaw);
  return { username, password };
}

async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown; registrationCode?: unknown; inviteCode?: unknown }>(request);
  const { username, password } = validateCredentials(body.username, body.password);
  const codeInput = body.registrationCode ?? body.inviteCode;
  const inviteCode = typeof codeInput === "string" ? codeInput.trim().toUpperCase() : "";
  if (!inviteCode) throw new ApiError(400, "请输入注册码");

  const invite = await env.DB.prepare(
    `SELECT id FROM invite_codes
     WHERE code = ? COLLATE NOCASE AND disabled = 0 AND use_count < max_uses
       AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).bind(inviteCode).first<{ id: string }>();
  if (!invite) throw new ApiError(400, "注册码无效、已用完或已过期");

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const userId = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, nickname, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, username, username, passwordHash, salt, count?.count === 0 ? "admin" : "member"),
      env.DB.prepare("INSERT INTO invite_redemptions (invite_id, user_id) VALUES (?, ?)").bind(invite.id, userId),
      env.DB.prepare("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses")
        .bind(invite.id)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) throw new ApiError(409, "用户名已被使用");
    if (message.includes("INVITE_UNAVAILABLE")) throw new ApiError(409, "注册码刚刚已被使用，请换一个注册码");
    throw error;
  }
  const cookie = await createSession(request, env, userId);
  return apiJson({ user: { id: userId, username, nickname: username, role: count?.count === 0 ? "admin" : "member" } }, 201, { "Set-Cookie": cookie });
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const { username, password } = validateCredentials(body.username, body.password);
  const account = await env.DB.prepare(
    "SELECT id, username, nickname, password_hash, password_salt, role, disabled FROM users WHERE username = ? COLLATE NOCASE"
  ).bind(username).first<User & { password_hash: string; password_salt: string; disabled: number }>();
  const calculated = await hashPassword(password, account?.password_salt ?? randomToken(16));
  if (!account || !constantTimeEqual(calculated, account.password_hash)) throw new ApiError(401, "用户名或密码不正确");
  if (account.disabled) throw new ApiError(403, "该账户已被管理员禁用");
  const cookie = await createSession(request, env, account.id);
  return apiJson({ user: { id: account.id, username: account.username, nickname: account.nickname, role: account.role } }, 200, { "Set-Cookie": cookie });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return apiJson({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}

function createInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `ACP-${value.slice(0, 5)}-${value.slice(5)}`;
}

async function bootstrapInvite(request: Request, env: Env): Promise<Response> {
  if (!env.BOOTSTRAP_TOKEN) throw new ApiError(404, "未启用初始注册码接口");
  const body = await readJson<{ token?: unknown }>(request);
  const token = typeof body.token === "string" ? body.token : "";
  if (!constantTimeEqual(token.padEnd(env.BOOTSTRAP_TOKEN.length, "\0").slice(0, env.BOOTSTRAP_TOKEN.length), env.BOOTSTRAP_TOKEN)) {
    throw new ApiError(403, "初始化令牌不正确");
  }
  const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if ((users?.count ?? 0) > 0) throw new ApiError(409, "已有用户，初始注册码接口已关闭");
  const existing = await env.DB.prepare(
    "SELECT code FROM invite_codes WHERE disabled = 0 AND use_count < max_uses AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1"
  ).first<{ code: string }>();
  if (existing) return apiJson({ registrationCode: existing.code, inviteCode: existing.code });
  const code = createInviteCode();
  await env.DB.prepare(
    "INSERT INTO invite_codes (id, code, max_uses, expires_at) VALUES (?, ?, 1, datetime('now', '+1 day'))"
  ).bind(crypto.randomUUID(), code).run();
  return apiJson({ registrationCode: code, inviteCode: code }, 201);
}

async function updateAccount(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ username?: unknown; nickname?: unknown; currentPassword?: unknown; newPassword?: unknown }>(request);
  if (body.username !== undefined) throw new ApiError(400, "登录用户名不可修改");
  const hasNickname = body.nickname !== undefined;
  const hasPassword = body.newPassword !== undefined;
  if (!hasNickname && !hasPassword) throw new ApiError(400, "没有需要更新的账户信息");

  const nickname = hasNickname ? validateNickname(body.nickname) : user.nickname;
  const statements: D1PreparedStatement[] = [];
  if (nickname !== user.nickname) {
    statements.push(env.DB.prepare("UPDATE users SET nickname = ? WHERE id = ?").bind(nickname, user.id));
  }

  if (hasPassword) {
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = validatePassword(body.newPassword);
    if (!currentPassword) throw new ApiError(400, "请输入当前密码");
    if (currentPassword === newPassword) throw new ApiError(400, "新密码不能与当前密码相同");
    const account = await env.DB.prepare(
      "SELECT password_hash, password_salt FROM users WHERE id = ?"
    ).bind(user.id).first<{ password_hash: string; password_salt: string }>();
    if (!account || !constantTimeEqual(await hashPassword(currentPassword, account.password_salt), account.password_hash)) {
      throw new ApiError(400, "当前密码不正确");
    }
    const salt = randomToken(16);
    const passwordHash = await hashPassword(newPassword, salt);
    statements.push(env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).bind(passwordHash, salt, user.id));
    const currentToken = getCookie(request, SESSION_COOKIE);
    if (currentToken) {
      statements.push(env.DB.prepare(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?"
      ).bind(user.id, await sha256(currentToken)));
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return apiJson({ user: { ...user, nickname }, passwordChanged: hasPassword });
}

function requireAdmin(user: User): void {
  if (user.role !== "admin") throw new ApiError(403, "仅管理员可以执行此操作");
}

interface NormalizedAdminQuestion {
  id: string;
  sourceId: number | null;
  type: "single" | "multiple";
  question: string;
  options: Record<string, string>;
  answers: string[];
  explanation: string;
  category: string;
  core: boolean;
  referenceUrl: string | null;
  active: boolean;
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "题目必须是 JSON 对象");
  return value as Record<string, unknown>;
}

async function normalizeAdminQuestion(value: unknown, existingId?: string): Promise<NormalizedAdminQuestion> {
  const raw = inputRecord(value);
  const type = normalizeQuestionType(String(raw.t ?? raw.type ?? ""));
  if (!type) throw new ApiError(400, "题型必须是单选题或多选题");
  const question = String(raw.q ?? raw.question ?? "").trim();
  if (question.length < 2 || question.length > 10_000) throw new ApiError(400, "题干长度需为 2-10000 个字符");

  const optionSource = inputRecord(raw.o ?? raw.options);
  const options: Record<string, string> = {};
  for (const [rawKey, rawText] of Object.entries(optionSource)) {
    const key = rawKey.trim().toUpperCase();
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!/^[A-Z]$/.test(key) || !text || text.length > 5_000) throw new ApiError(400, `选项 ${rawKey} 格式不正确`);
    if (key in options) throw new ApiError(400, `选项 ${key} 重复`);
    options[key] = text;
  }
  if (Object.keys(options).length < 2 || Object.keys(options).length > 10) throw new ApiError(400, "每道题需包含 2-10 个选项");

  const answers = normalizeAnswers(raw.a ?? raw.answers ?? raw.correctAnswers);
  if (!answers.length || answers.some((answer) => !(answer in options))) throw new ApiError(400, "正确答案必须对应已有选项");
  if (type === "single" && answers.length !== 1) throw new ApiError(400, "单选题只能有一个正确答案");

  const sourceValue = raw.i ?? raw.sourceId ?? raw.number;
  let sourceId: number | null = null;
  if (sourceValue !== undefined && sourceValue !== null && sourceValue !== "") {
    sourceId = Number(sourceValue);
    if (!Number.isInteger(sourceId) || sourceId < 0) throw new ApiError(400, "题目编号必须是非负整数");
  }
  const rawId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (rawId && !/^[A-Za-z0-9_-]{1,80}$/.test(rawId)) throw new ApiError(400, "题目 ID 格式不正确");
  let id = existingId ?? (sourceId != null ? `source-${sourceId}` : rawId);
  if (!id) {
    const digest = (await sha256(question)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "").slice(0, 20);
    id = `custom-${digest}`;
  }
  const explanation = String(raw.e ?? raw.explanation ?? "").trim();
  if (explanation.length > 20_000) throw new ApiError(400, "答案解析不能超过 20000 个字符");
  const category = String(raw.k ?? raw.category ?? "未分类").trim() || "未分类";
  if (category.length > 80) throw new ApiError(400, "知识分类不能超过 80 个字符");
  const referenceValue = raw.r ?? raw.referenceUrl;
  const referenceUrl = referenceValue == null || referenceValue === "" ? null : String(referenceValue).trim();
  if (referenceUrl) {
    try {
      const url = new URL(referenceUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      throw new ApiError(400, "参考链接必须是有效的 HTTP(S) 地址");
    }
  }
  if (raw.core !== undefined && typeof raw.core !== "boolean") throw new ApiError(400, "core 字段必须是布尔值");
  if (raw.active !== undefined && typeof raw.active !== "boolean") throw new ApiError(400, "active 字段必须是布尔值");
  return {
    id,
    sourceId,
    type,
    question,
    options,
    answers,
    explanation,
    category,
    core: raw.core === true,
    referenceUrl,
    active: raw.active !== false
  };
}

function questionUpsert(env: Env, item: NormalizedAdminQuestion): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO questions (id, source_id, type, question, options_json, answer_json, explanation, category, is_core, reference_url, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_id = excluded.source_id, type = excluded.type, question = excluded.question,
       options_json = excluded.options_json, answer_json = excluded.answer_json,
       explanation = excluded.explanation, category = excluded.category, is_core = excluded.is_core,
       reference_url = excluded.reference_url, active = excluded.active, updated_at = datetime('now')`
  ).bind(
    item.id, item.sourceId, item.type, item.question, JSON.stringify(item.options), JSON.stringify(item.answers),
    item.explanation, item.category, item.core ? 1 : 0, item.referenceUrl, item.active ? 1 : 0
  );
}

function mapAdminQuestion(row: QuestionRow & { active: number; updated_at?: string }) {
  return {
    id: row.id,
    number: row.source_id,
    type: row.type,
    question: row.question,
    options: JSON.parse(row.options_json) as Record<string, string>,
    correctAnswers: normalizeAnswers(JSON.parse(row.answer_json ?? "[]")),
    explanation: row.explanation ?? "",
    category: row.category,
    core: Boolean(row.is_core),
    referenceUrl: row.reference_url ?? null,
    active: Boolean(row.active),
    updatedAt: row.updated_at ?? null
  };
}

async function importQuestions(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ questions?: unknown; replaceExisting?: unknown }>(request);
  if (!Array.isArray(body.questions) || !body.questions.length) throw new ApiError(400, "请选择至少一道题目");
  if (body.questions.length > 500) throw new ApiError(400, "单次最多导入 500 道题");
  if (body.replaceExisting !== undefined && typeof body.replaceExisting !== "boolean") throw new ApiError(400, "覆盖模式参数不正确");
  const questions = await Promise.all(body.questions.map(async (item, index) => {
    try {
      return await normalizeAdminQuestion(item);
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.status, `第 ${index + 1} 道题：${error.message}`);
      throw error;
    }
  }));
  const ids = new Set<string>();
  for (const item of questions) {
    if (ids.has(item.id)) throw new ApiError(400, `题目 ID 重复：${item.id}`);
    ids.add(item.id);
  }
  const statements: D1PreparedStatement[] = [];
  if (body.replaceExisting) statements.push(env.DB.prepare("UPDATE questions SET active = 0, updated_at = datetime('now') WHERE active = 1"));
  statements.push(...questions.map((item) => questionUpsert(env, item)));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new ApiError(409, "题目编号与现有题目冲突");
    throw error;
  }
  return apiJson({ imported: questions.length, mode: body.replaceExisting ? "replace" : "merge" });
}

async function getAdminQuestions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80);
  const status = url.searchParams.get("status") ?? "all";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const conditions = ["1 = 1"];
  const values: unknown[] = [];
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push("(question LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR CAST(source_id AS TEXT) = ?)");
    values.push(pattern, pattern, search);
  }
  if (status === "active") conditions.push("active = 1");
  else if (status === "inactive") conditions.push("active = 0");
  else if (status !== "all") throw new ApiError(400, "未知的题目状态");
  const where = conditions.join(" AND ");
  const rows = await env.DB.prepare(
    `SELECT id, source_id, type, question, options_json, answer_json, explanation, category,
      is_core, reference_url, active, updated_at
     FROM questions WHERE ${where} ORDER BY active DESC, COALESCE(source_id, 2147483647), updated_at DESC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all<QuestionRow & { active: number; updated_at: string }>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE ${where}`).bind(...values).first<{ count: number }>();
  return apiJson({ questions: rows.results.map(mapAdminQuestion), total: total?.count ?? 0 });
}

async function updateAdminQuestionsStatus(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ ids?: unknown; active?: unknown }>(request);
  if (!Array.isArray(body.ids) || !body.ids.length) throw new ApiError(400, "请选择至少一道题目");
  if (body.ids.length > 500) throw new ApiError(400, "单次最多更新 500 道题");
  if (typeof body.active !== "boolean") throw new ApiError(400, "题目状态参数不正确");
  const ids = [...new Set(body.ids.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "题目 ID 格式不正确");
    return value.trim();
  }))];
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < ids.length; offset += 90) {
    const chunk = ids.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    statements.push(env.DB.prepare(
      `UPDATE questions SET active = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).bind(body.active ? 1 : 0, ...chunk));
  }
  const results = await env.DB.batch(statements);
  const updated = results.reduce((count, result) => count + (result.meta?.changes ?? 0), 0);
  return apiJson({ updated, active: body.active });
}

async function updateAdminQuestion(request: Request, env: Env, questionId: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId).first();
  if (!existing) throw new ApiError(404, "题目不存在");
  const body = await readJson<unknown>(request);
  const item = await normalizeAdminQuestion(body, questionId);
  try {
    await questionUpsert(env, item).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new ApiError(409, "题目编号与现有题目冲突");
    throw error;
  }
  const row = await env.DB.prepare(
    `SELECT id, source_id, type, question, options_json, answer_json, explanation, category,
      is_core, reference_url, active, updated_at FROM questions WHERE id = ?`
  ).bind(questionId).first<QuestionRow & { active: number; updated_at: string }>();
  return apiJson({ question: mapAdminQuestion(row!) });
}

async function getAdminUsers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 40);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (search) {
    conditions.push("(u.username LIKE ? ESCAPE '\\' OR u.nickname LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(search)}%`;
    values.push(pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, u.role, u.disabled, u.created_at AS createdAt,
      COUNT(a.id) AS attempts, COALESCE(SUM(a.is_correct), 0) AS correct,
      COUNT(DISTINCT a.question_id) AS practiced,
      COALESCE((SELECT SUM(m.active = 1 AND (COALESCE(m.manually_added, 0) = 1 OR COALESCE(m.correct_streak, 0) < 2)) FROM mistakes m WHERE m.user_id = u.id), 0) AS activeMistakes
     FROM users u LEFT JOIN attempts a ON a.user_id = u.id ${where}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all<Record<string, unknown>>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).bind(...values).first<{ count: number }>();
  return apiJson({
    users: rows.results.map((row) => ({
      id: String(row.id),
      username: String(row.username),
      nickname: String(row.nickname),
      role: row.role,
      disabled: Boolean(row.disabled),
      createdAt: row.createdAt,
      attempts: Number(row.attempts ?? 0),
      practiced: Number(row.practiced ?? 0),
      accuracy: Number(row.attempts) ? Math.round((Number(row.correct) / Number(row.attempts)) * 100) : 0,
      activeMistakes: Number(row.activeMistakes ?? 0)
    })),
    total: total?.count ?? 0
  });
}

async function updateAdminUser(request: Request, env: Env, admin: User, targetId: string): Promise<Response> {
  const body = await readJson<{ role?: unknown; disabled?: unknown }>(request);
  const target = await env.DB.prepare(
    "SELECT id, username, nickname, role, disabled FROM users WHERE id = ?"
  ).bind(targetId).first<User & { disabled: number }>();
  if (!target) throw new ApiError(404, "用户不存在");
  const role = body.role === undefined ? target.role : body.role;
  const disabled = body.disabled === undefined ? Boolean(target.disabled) : body.disabled;
  if (role !== "admin" && role !== "member") throw new ApiError(400, "用户角色不正确");
  if (typeof disabled !== "boolean") throw new ApiError(400, "用户状态不正确");
  if (target.id === admin.id && (role !== "admin" || disabled)) throw new ApiError(400, "不能禁用或降级当前管理员账户");

  const removesActiveAdmin = target.role === "admin" && !target.disabled && (role !== "admin" || disabled);
  if (removesActiveAdmin) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0"
    ).first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) throw new ApiError(409, "系统必须保留至少一个有效管理员");
  }
  const statements = [env.DB.prepare("UPDATE users SET role = ?, disabled = ? WHERE id = ?").bind(role, disabled ? 1 : 0, target.id)];
  if (disabled) statements.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id));
  await env.DB.batch(statements);
  return apiJson({ user: { id: target.id, username: target.username, nickname: target.nickname, role, disabled } });
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function mapQuestion(row: QuestionRow) {
  return {
    id: row.id,
    number: row.source_id,
    type: row.type,
    question: row.question,
    options: JSON.parse(row.options_json) as Record<string, string>,
    category: row.category,
    core: Boolean(row.is_core),
    progress: {
      attempts: row.attempt_count ?? 0,
      lastCorrect: row.last_is_correct == null ? null : Boolean(row.last_is_correct),
      marked: Boolean(row.is_marked),
      wrongCount: row.wrong_count ?? 0,
      nextReviewAt: row.next_review_at ?? null
    }
  };
}

function practiceKeyFromParams(params: URLSearchParams): string {
  const scope = params.get("scope") ?? "all";
  const type = params.get("type") ?? "all";
  const category = (params.get("category") ?? "").trim();
  const search = (params.get("search") ?? "").trim().slice(0, 80);
  const review = params.get("review") ?? "sequence";
  return JSON.stringify([scope, type, category, search, review]);
}

async function getQuestions(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const type = url.searchParams.get("type") ?? "all";
  const category = (url.searchParams.get("category") ?? "").trim();
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80);
  const review = url.searchParams.get("review") ?? "sequence";
  const catalogOrder = url.searchParams.get("catalog") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 40, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions = ["q.active = 1"];
  const values: unknown[] = [user.id, user.id];
  if (scope === "core") conditions.push("q.is_core = 1");
  else if (scope === "wrong") conditions.push("m.active = 1 AND (COALESCE(m.manually_added, 0) = 1 OR COALESCE(m.correct_streak, 0) < 2)");
  else if (scope !== "all") throw new ApiError(400, "未知的题库范围");
  if (type === "single" || type === "multiple") {
    conditions.push("q.type = ?");
    values.push(type);
  } else if (type !== "all") throw new ApiError(400, "未知的题型");
  if (category) {
    conditions.push("q.category = ?");
    values.push(category);
  }
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push("(q.question LIKE ? ESCAPE '\\' OR q.options_json LIKE ? ESCAPE '\\' OR q.explanation LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern, pattern);
  }
  if (scope === "wrong" && review === "due") conditions.push("(m.next_review_at IS NULL OR datetime(m.next_review_at) <= datetime('now'))");

  let order = "COALESCE(q.source_id, 2147483647), q.created_at";
  if (review === "random") order = catalogOrder ? "COALESCE(q.source_id, 2147483647), q.created_at, q.id" : "RANDOM()";
  else if (scope === "wrong" && review === "frequency") order = "m.wrong_count DESC, m.last_wrong_at DESC, q.id";
  else if (scope === "wrong" && review === "due") order = "COALESCE(m.next_review_at, m.last_wrong_at), m.wrong_count DESC, q.id";
  else if (review !== "sequence") throw new ApiError(400, "未知的出题顺序");
  else order = "COALESCE(q.source_id, 2147483647), q.created_at, q.id";

  const from = `FROM questions q
    LEFT JOIN user_progress p ON p.question_id = q.id AND p.user_id = ?
    LEFT JOIN mistakes m ON m.question_id = q.id AND m.user_id = ?
    WHERE ${conditions.join(" AND ")}`;
  const rows = await env.DB.prepare(
    `SELECT q.id, q.source_id, q.type, q.question, q.options_json, q.category, q.is_core,
      p.attempt_count, p.last_is_correct,
      CASE WHEN m.active = 1 AND (COALESCE(m.manually_added, 0) = 1 OR COALESCE(m.correct_streak, 0) < 2) THEN 1 ELSE 0 END AS is_marked,
      m.wrong_count, m.next_review_at
     ${from} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all<QuestionRow>();
  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN p.attempt_count > 0 THEN 1 ELSE 0 END), 0) AS practiced ${from}`
  ).bind(...values).first<{ count: number; practiced: number }>();
  const practiceKey = practiceKeyFromParams(url.searchParams);
  const cursor = await env.DB.prepare(
    "SELECT question_id AS questionId FROM practice_cursors WHERE user_id = ? AND practice_key = ?"
  ).bind(user.id, practiceKey).first<{ questionId: string }>();
  return apiJson({
    questions: rows.results.map(mapQuestion),
    total: summary?.count ?? 0,
    practiced: summary?.practiced ?? 0,
    resumeQuestionId: cursor?.questionId ?? null
  });
}

async function updatePracticeCursor(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ query?: unknown; questionId?: unknown }>(request);
  const query = typeof body.query === "string" ? body.query : "";
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (query.length > 500 || !questionId) throw new ApiError(400, "练习位置参数不正确");
  const exists = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND active = 1").bind(questionId).first();
  if (!exists) throw new ApiError(404, "题目不存在或已停用");
  const practiceKey = practiceKeyFromParams(new URLSearchParams(query));
  await env.DB.prepare(
    `INSERT INTO practice_cursors (user_id, practice_key, question_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, practice_key) DO UPDATE SET question_id = excluded.question_id, updated_at = excluded.updated_at`
  ).bind(user.id, practiceKey, questionId).run();
  return apiJson({ ok: true });
}

async function submitAnswer(request: Request, env: Env, user: User, questionId: string): Promise<Response> {
  const body = await readJson<{ answers?: unknown; mode?: unknown }>(request);
  const answers = normalizeAnswers(body.answers);
  const mode = typeof body.mode === "string" ? body.mode.slice(0, 24) : "all";
  const question = await env.DB.prepare(
    "SELECT id, type, options_json, answer_json, explanation, reference_url FROM questions WHERE id = ? AND active = 1"
  ).bind(questionId).first<QuestionRow>();
  if (!question) throw new ApiError(404, "题目不存在或已停用");
  const options = JSON.parse(question.options_json) as Record<string, string>;
  if (!answers.length || answers.some((answer) => !(answer in options))) throw new ApiError(400, "请选择有效答案");
  if (question.type === "single" && answers.length !== 1) throw new ApiError(400, "单选题只能选择一个答案");

  const expected = normalizeAnswers(JSON.parse(question.answer_json ?? "[]"));
  const correct = isAnswerCorrect(answers, expected);
  const existingMistake = await env.DB.prepare(
    "SELECT active, manually_added, correct_streak FROM mistakes WHERE user_id = ? AND question_id = ?"
  ).bind(user.id, questionId).first<{ active: number; manually_added: number; correct_streak: number }>();
  const statements = [
    env.DB.prepare(
      "INSERT INTO attempts (user_id, question_id, submitted_json, is_correct, practice_mode) VALUES (?, ?, ?, ?, ?)"
    ).bind(user.id, questionId, JSON.stringify(answers), correct ? 1 : 0, mode),
    env.DB.prepare(
      `INSERT INTO user_progress (user_id, question_id, attempt_count, correct_count, last_is_correct, last_answer_json, last_attempt_at)
       VALUES (?, ?, 1, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         attempt_count = attempt_count + 1,
         correct_count = correct_count + excluded.correct_count,
         last_is_correct = excluded.last_is_correct,
         last_answer_json = excluded.last_answer_json,
         last_attempt_at = excluded.last_attempt_at`
    ).bind(user.id, questionId, correct ? 1 : 0, correct ? 1 : 0, JSON.stringify(answers))
  ];

  let mistakeActive = Boolean(existingMistake?.active);
  if (!correct) {
    mistakeActive = true;
    statements.push(env.DB.prepare(
      `INSERT INTO mistakes (user_id, question_id, active, wrong_count, correct_streak, last_wrong_at, next_review_at)
       VALUES (?, ?, 1, 1, 0, datetime('now'), datetime('now', '+1 day'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         active = 1, wrong_count = mistakes.wrong_count + 1, correct_streak = 0,
         last_wrong_at = datetime('now'), next_review_at = datetime('now', '+1 day')`
    ).bind(user.id, questionId));
  } else if (existingMistake) {
    const streak = existingMistake.correct_streak + 1;
    mistakeActive = existingMistake.manually_added === 1 || streak < 2;
    statements.push(env.DB.prepare(
      `UPDATE mistakes SET active = ?, review_count = review_count + 1, correct_streak = ?,
       last_review_at = datetime('now'), next_review_at = ? WHERE user_id = ? AND question_id = ?`
    ).bind(mistakeActive ? 1 : 0, streak, nextReviewDate(streak), user.id, questionId));
  }
  await env.DB.batch(statements);
  return apiJson({
    correct,
    correctAnswers: expected,
    explanation: question.explanation ?? "",
    referenceUrl: question.reference_url ?? null,
    mistakeActive
  });
}

async function updateMark(request: Request, env: Env, user: User, questionId: string): Promise<Response> {
  const body = await readJson<{ action?: unknown }>(request);
  const exists = await env.DB.prepare("SELECT id FROM questions WHERE id = ? AND active = 1").bind(questionId).first();
  if (!exists) throw new ApiError(404, "题目不存在或已停用");
  if (body.action === "add") {
    await env.DB.prepare(
      `INSERT INTO mistakes (user_id, question_id, active, manually_added, wrong_count, correct_streak, last_wrong_at, next_review_at)
       VALUES (?, ?, 1, 1, 0, 0, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET active = 1, manually_added = 1, next_review_at = datetime('now')`
    ).bind(user.id, questionId).run();
    return apiJson({ marked: true });
  }
  if (body.action === "remove") {
    await env.DB.prepare(
      "UPDATE mistakes SET active = 0, manually_added = 0 WHERE user_id = ? AND question_id = ?"
    ).bind(user.id, questionId).run();
    return apiJson({ marked: false });
  }
  throw new ApiError(400, "未知的标记操作");
}

async function getMeta(env: Env): Promise<Response> {
  const [categories, totals] = await env.DB.batch([
    env.DB.prepare(
      "SELECT category, COUNT(*) AS count, SUM(is_core) AS core_count FROM questions WHERE active = 1 GROUP BY category ORDER BY count DESC, category"
    ),
    env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(is_core) AS core, SUM(type = 'single') AS single, SUM(type = 'multiple') AS multiple FROM questions WHERE active = 1"
    )
  ]);
  return apiJson({ categories: categories.results, totals: totals.results[0] ?? { total: 0, core: 0, single: 0, multiple: 0 } });
}

function calculateStreak(days: string[]): number {
  const set = new Set(days);
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const today = cursor.toISOString().slice(0, 10);
  if (!set.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

async function getStats(env: Env, user: User): Promise<Response> {
  const [attempts, mistakes, totalQuestions, recentDays] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS attempts, COALESCE(SUM(is_correct), 0) AS correct,
       COUNT(DISTINCT question_id) AS practiced,
       SUM(created_at >= datetime('now', '-7 days')) AS weekly
       FROM attempts WHERE user_id = ?`
    ).bind(user.id),
    env.DB.prepare(
      `SELECT SUM(active = 1 AND (COALESCE(manually_added, 0) = 1 OR COALESCE(correct_streak, 0) < 2)) AS active,
       SUM(active = 1 AND (COALESCE(manually_added, 0) = 1 OR COALESCE(correct_streak, 0) < 2)
         AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))) AS due
       FROM mistakes WHERE user_id = ?`
    ).bind(user.id),
    env.DB.prepare("SELECT COUNT(*) AS count FROM questions WHERE active = 1"),
    env.DB.prepare("SELECT DISTINCT date(created_at) AS day FROM attempts WHERE user_id = ? ORDER BY day DESC LIMIT 90").bind(user.id)
  ]);
  const activity = (attempts.results[0] ?? {}) as Record<string, number>;
  const wrong = (mistakes.results[0] ?? {}) as Record<string, number>;
  const days = (recentDays.results as Array<{ day: string }>).map((row) => row.day);
  return apiJson({
    attempts: activity.attempts ?? 0,
    correct: activity.correct ?? 0,
    practiced: activity.practiced ?? 0,
    weekly: activity.weekly ?? 0,
    accuracy: activity.attempts ? Math.round((activity.correct / activity.attempts) * 100) : 0,
    activeMistakes: wrong.active ?? 0,
    dueMistakes: wrong.due ?? 0,
    totalQuestions: Number((totalQuestions.results[0] as { count?: number } | undefined)?.count ?? 0),
    streak: calculateStreak(days)
  });
}

async function getRegistrationCodes(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT i.code, i.max_uses AS maxUses, i.use_count AS useCount, i.disabled,
      i.expires_at AS expiresAt, i.created_at AS createdAt,
      COALESCE(u.nickname, u.username, '初始化') AS createdBy
     FROM invite_codes i LEFT JOIN users u ON u.id = i.creator_id
     ORDER BY i.created_at DESC LIMIT 50`
  ).all();
  return apiJson({ registrationCodes: rows.results });
}

async function createRegistrationCode(env: Env, user: User): Promise<Response> {
  const unused = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM invite_codes WHERE creator_id = ? AND disabled = 0 AND use_count < max_uses AND expires_at > datetime('now')"
  ).bind(user.id).first<{ count: number }>();
  if ((unused?.count ?? 0) >= 5) throw new ApiError(429, "每位管理员最多同时保留 5 个未使用的注册码");
  const code = createInviteCode();
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO invite_codes (id, code, creator_id, max_uses, expires_at) VALUES (?, ?, ?, 1, datetime(?))"
  ).bind(crypto.randomUUID(), code, user.id, expiresAt).run();
  return apiJson({ registrationCode: { code, maxUses: 1, useCount: 0, disabled: 0, expiresAt, createdAt: new Date().toISOString(), createdBy: user.nickname || user.username } }, 201);
}

function templateSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    slot: Number(row.slot),
    title: String(row.title),
    questionCount: Number(row.questionCount ?? 0),
    singleCount: Number(row.singleCount ?? 0),
    multipleCount: Number(row.multipleCount ?? 0),
    updatedAt: String(row.updatedAt)
  };
}

async function getAdminMockTemplates(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.slot, t.title, t.updated_at AS updatedAt,
      COUNT(i.id) AS questionCount,
      COALESCE(SUM(i.type = 'single'), 0) AS singleCount,
      COALESCE(SUM(i.type = 'multiple'), 0) AS multipleCount
     FROM mock_exam_templates t
     LEFT JOIN mock_exam_template_items i ON i.template_id = t.id
     WHERE t.active = 1
     GROUP BY t.id ORDER BY t.slot`
  ).all<Record<string, unknown>>();
  return apiJson({ templates: rows.results.map(templateSummary) });
}

async function uploadMockTemplate(request: Request, env: Env, user: User, slotValue: string): Promise<Response> {
  const slot = Number(slotValue);
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) throw new ApiError(400, "套卷编号必须为 1-6");
  const body = await readJson<{ title?: unknown; questions?: unknown }>(request);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) throw new ApiError(400, "套卷名称需为 1-80 个字符");
  if (!Array.isArray(body.questions) || body.questions.length !== 75) throw new ApiError(400, "每套模拟题必须正好包含 75 道题");
  const normalized = await Promise.all(body.questions.map(async (value, index) => {
    try {
      return await normalizeAdminQuestion(value);
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.status, `第 ${index + 1} 道题：${error.message}`);
      throw error;
    }
  }));
  const singles = normalized.filter((item) => item.type === "single");
  const multiples = normalized.filter((item) => item.type === "multiple");
  if (singles.length !== 50 || multiples.length !== 25) {
    throw new ApiError(400, `套卷需要 50 道单选题和 25 道多选题，当前为 ${singles.length} 道单选、${multiples.length} 道多选`);
  }
  const templateId = `mock-template-${slot}`;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO mock_exam_templates (id, slot, title, created_by, active)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(slot) DO UPDATE SET title = excluded.title, created_by = excluded.created_by,
         active = 1, updated_at = datetime('now')`
    ).bind(templateId, slot, title, user.id),
    env.DB.prepare("DELETE FROM mock_exam_template_items WHERE template_id = ?").bind(templateId)
  ];
  [...singles, ...multiples].forEach((item, index) => {
    statements.push(env.DB.prepare(
      `INSERT INTO mock_exam_template_items
       (id, template_id, position, type, question, options_json, answer_json, explanation, category, reference_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), templateId, index + 1, item.type, item.question,
      JSON.stringify(item.options), JSON.stringify(item.answers), item.explanation, item.category, item.referenceUrl
    ));
  });
  await env.DB.batch(statements);
  return apiJson({ template: { id: templateId, slot, title, questionCount: 75, singleCount: 50, multipleCount: 25, updatedAt: new Date().toISOString() } });
}

function mapMockExamSummary(row: MockExamRow & { answeredCount?: number; markedCount?: number }) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    status: row.status,
    templateId: row.template_id,
    durationSeconds: row.duration_seconds,
    remainingSeconds: row.remaining_seconds,
    score: row.score,
    passed: row.passed == null ? null : Boolean(row.passed),
    wrongCount: row.wrong_count,
    answeredCount: Number(row.answeredCount ?? 0),
    markedCount: Number(row.markedCount ?? 0),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at
  };
}

async function getMockExamCatalog(env: Env, user: User): Promise<Response> {
  const [templates, exams, coreCounts, categoryCounts] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.slot, t.title, t.updated_at AS updatedAt,
        COUNT(i.id) AS questionCount,
        COALESCE(SUM(i.type = 'single'), 0) AS singleCount,
        COALESCE(SUM(i.type = 'multiple'), 0) AS multipleCount
       FROM mock_exam_templates t LEFT JOIN mock_exam_template_items i ON i.template_id = t.id
       WHERE t.active = 1 GROUP BY t.id ORDER BY t.slot`
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT e.*,
        COALESCE(SUM(CASE WHEN i.selected_json IS NOT NULL AND i.selected_json != '[]' THEN 1 ELSE 0 END), 0) AS answeredCount,
        COALESCE(SUM(i.marked), 0) AS markedCount
       FROM mock_exams e LEFT JOIN mock_exam_items i ON i.exam_id = e.id
       WHERE e.user_id = ? GROUP BY e.id ORDER BY e.updated_at DESC, e.started_at DESC`
    ).bind(user.id).all<MockExamRow & { answeredCount: number; markedCount: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(type = 'single'), 0) AS singleCount,
        COALESCE(SUM(type = 'multiple'), 0) AS multipleCount
       FROM questions WHERE active = 1 AND is_core = 1`
    ).first<{ singleCount: number; multipleCount: number }>(),
    env.DB.prepare(
      `SELECT category, type, COUNT(*) AS count
       FROM questions WHERE active = 1 AND is_core = 1
       GROUP BY category, type`
    ).all<{ category: string; type: "single" | "multiple"; count: number }>()
  ]);
  const categoryCountMap = new Map<string, number>();
  for (const row of categoryCounts.results) {
    const key = `${canonicalMockCategory(row.category)}\u0000${row.type}`;
    categoryCountMap.set(key, (categoryCountMap.get(key) ?? 0) + Number(row.count));
  }
  const randomDistribution = MOCK_EXAM_CATEGORY_QUOTAS.map((quota) => ({
    ...quota,
    availableSingle: categoryCountMap.get(`${quota.category}\u0000single`) ?? 0,
    availableMultiple: categoryCountMap.get(`${quota.category}\u0000multiple`) ?? 0
  }));
  return apiJson({
    templates: templates.results.map(templateSummary),
    exams: exams.results.map(mapMockExamSummary),
    coreAvailability: { single: Number(coreCounts?.singleCount ?? 0), multiple: Number(coreCounts?.multipleCount ?? 0) },
    randomDistribution
  });
}

function mockExamItemInsert(env: Env, examId: string, itemId: string, position: number, item: MockSourceRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO mock_exam_items
     (id, exam_id, position, source_question_id, type, question, options_json, answer_json, explanation, category, reference_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    itemId, examId, position, item.source_question_id ?? null, item.type, item.question,
    item.options_json, item.answer_json, item.explanation, item.category, item.reference_url
  );
}

async function createMockExam(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ source?: unknown; templateId?: unknown }>(request);
  if (body.source !== "fixed" && body.source !== "random") throw new ApiError(400, "模拟题来源不正确");
  let title = "";
  let templateId: string | null = null;
  let items: MockSourceRow[] = [];
  if (body.source === "fixed") {
    templateId = typeof body.templateId === "string" ? body.templateId : "";
    const template = await env.DB.prepare(
      "SELECT id, title FROM mock_exam_templates WHERE id = ? AND active = 1"
    ).bind(templateId).first<{ id: string; title: string }>();
    if (!template) throw new ApiError(404, "固定模拟题不存在");
    title = template.title;
    const rows = await env.DB.prepare(
      `SELECT NULL AS source_question_id, type, question, options_json, answer_json, explanation, category, reference_url
       FROM mock_exam_template_items WHERE template_id = ? ORDER BY position`
    ).bind(template.id).all<MockSourceRow>();
    items = rows.results;
  } else {
    const [selections, count] = await Promise.all([
      Promise.all(MOCK_EXAM_CATEGORY_QUOTAS.map(async (quota) => {
        const categoryNames = mockCategoryAliases(quota.category);
        const categoryPlaceholders = categoryNames.map(() => "?").join(", ");
        const [singles, multiples] = await Promise.all([
          env.DB.prepare(
            `SELECT id AS source_question_id, type, question, options_json, answer_json, explanation, category, reference_url
             FROM questions
             WHERE active = 1 AND is_core = 1 AND type = 'single' AND category COLLATE NOCASE IN (${categoryPlaceholders})
             ORDER BY RANDOM() LIMIT ${quota.single}`
          ).bind(...categoryNames).all<MockSourceRow>(),
          env.DB.prepare(
            `SELECT id AS source_question_id, type, question, options_json, answer_json, explanation, category, reference_url
             FROM questions
             WHERE active = 1 AND is_core = 1 AND type = 'multiple' AND category COLLATE NOCASE IN (${categoryPlaceholders})
             ORDER BY RANDOM() LIMIT ${quota.multiple}`
          ).bind(...categoryNames).all<MockSourceRow>()
        ]);
        return {
          quota,
          singles: singles.results.map((item) => ({ ...item, category: quota.category })),
          multiples: multiples.results.map((item) => ({ ...item, category: quota.category }))
        };
      })),
      env.DB.prepare("SELECT COUNT(*) AS count FROM mock_exams WHERE user_id = ? AND source = 'random'").bind(user.id).first<{ count: number }>()
    ]);
    const shortages = selections.flatMap(({ quota, singles, multiples }) => [
      singles.length < quota.single ? `${quota.category}单选需要 ${quota.single} 道，当前 ${singles.length} 道` : "",
      multiples.length < quota.multiple ? `${quota.category}多选需要 ${quota.multiple} 道，当前 ${multiples.length} 道` : ""
    ]).filter(Boolean);
    if (shortages.length) throw new ApiError(409, `核心题库按官方比例题量不足：${shortages.join("；")}`);
    items = selections.flatMap(({ singles, multiples }) => [...singles, ...multiples]);
    title = `随机模拟题 #${Number(count?.count ?? 0) + 1}`;
  }
  if (items.length !== 75) throw new ApiError(409, "模拟题模板不完整，请联系管理员重新上传");
  const examId = crypto.randomUUID();
  const itemIds = items.map(() => crypto.randomUUID());
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO mock_exams
       (id, user_id, template_id, source, title, duration_seconds, remaining_seconds, current_item_id, current_section)
       VALUES (?, ?, ?, ?, ?, 7200, 7200, ?, 'single')`
    ).bind(examId, user.id, templateId, body.source, title, itemIds[0])
  ];
  items.forEach((item, index) => statements.push(mockExamItemInsert(env, examId, itemIds[index], index + 1, item)));
  await env.DB.batch(statements);
  return apiJson({ exam: { id: examId, title, source: body.source, status: "in_progress" } }, 201);
}

async function requireOwnedMockExam(env: Env, user: User, examId: string): Promise<MockExamRow> {
  const exam = await env.DB.prepare("SELECT * FROM mock_exams WHERE id = ? AND user_id = ?").bind(examId, user.id).first<MockExamRow>();
  if (!exam) throw new ApiError(404, "模拟题不存在");
  return exam;
}

async function getMockExam(env: Env, user: User, examId: string): Promise<Response> {
  const exam = await requireOwnedMockExam(env, user, examId);
  const rows = await env.DB.prepare(
    `SELECT id, position, source_question_id, type, question, options_json, answer_json,
      explanation, category, reference_url, selected_json, marked
     FROM mock_exam_items WHERE exam_id = ? ORDER BY position`
  ).bind(examId).all<MockExamItemRow>();
  const submitted = exam.status === "submitted";
  const items = rows.results.map((item) => {
    const selectedAnswers = normalizeAnswers(item.selected_json ? JSON.parse(item.selected_json) : []);
    const correctAnswers = normalizeAnswers(JSON.parse(item.answer_json));
    return {
      id: item.id,
      position: item.position,
      type: item.type,
      question: item.question,
      options: JSON.parse(item.options_json) as Record<string, string>,
      category: item.category,
      selectedAnswers,
      marked: Boolean(item.marked),
      ...(submitted ? {
        correctAnswers,
        correct: isAnswerCorrect(selectedAnswers, correctAnswers),
        explanation: item.explanation,
        referenceUrl: item.reference_url
      } : {})
    };
  });
  return apiJson({
    exam: {
      ...mapMockExamSummary(exam),
      currentItemId: exam.current_item_id,
      currentSection: exam.current_section
    },
    items
  });
}

async function updateMockExamProgress(request: Request, env: Env, user: User, examId: string): Promise<Response> {
  const exam = await requireOwnedMockExam(env, user, examId);
  if (exam.status !== "in_progress") throw new ApiError(409, "模拟题已经交卷，不能修改答案");
  const body = await readJson<{
    itemId?: unknown;
    answers?: unknown;
    marked?: unknown;
    remainingSeconds?: unknown;
    currentItemId?: unknown;
    currentSection?: unknown;
    responses?: unknown;
  }>(request);
  const statements: D1PreparedStatement[] = [];
  if (body.responses !== undefined) {
    if (!Array.isArray(body.responses) || body.responses.length > 75) throw new ApiError(400, "批量答题数据不正确");
    for (const value of body.responses) {
      const response = inputRecord(value);
      const responseItemId = typeof response.itemId === "string" ? response.itemId : "";
      if (!responseItemId || !Array.isArray(response.answers) || response.answers.some((answer) => typeof answer !== "string")) {
        throw new ApiError(400, "批量答题数据不正确");
      }
      const answers = normalizeAnswers(response.answers);
      if (answers.length > 10 || answers.some((answer) => !/^[A-Z]$/.test(answer))) throw new ApiError(400, "批量答案选项不正确");
      if (typeof response.marked !== "boolean") throw new ApiError(400, "批量标记状态不正确");
      statements.push(env.DB.prepare(
        `UPDATE mock_exam_items SET selected_json = ?, marked = ?,
          answered_at = CASE WHEN ? = '[]' THEN NULL ELSE datetime('now') END
         WHERE id = ? AND exam_id = ?
           AND EXISTS (SELECT 1 FROM mock_exams WHERE id = ? AND user_id = ? AND status = 'in_progress')`
      ).bind(JSON.stringify(answers), response.marked ? 1 : 0, JSON.stringify(answers), responseItemId, examId, examId, user.id));
    }
  }
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (body.answers !== undefined || body.marked !== undefined) {
    if (!itemId) throw new ApiError(400, "缺少模拟题题目 ID");
    const item = await env.DB.prepare(
      "SELECT type, options_json FROM mock_exam_items WHERE id = ? AND exam_id = ?"
    ).bind(itemId, examId).first<{ type: "single" | "multiple"; options_json: string }>();
    if (!item) throw new ApiError(404, "模拟题题目不存在");
    if (body.answers !== undefined) {
      if (!Array.isArray(body.answers) || body.answers.some((value) => typeof value !== "string")) throw new ApiError(400, "答案格式不正确");
      const answers = normalizeAnswers(body.answers);
      const options = JSON.parse(item.options_json) as Record<string, string>;
      if (answers.some((answer) => !(answer in options)) || (item.type === "single" && answers.length > 1)) {
        throw new ApiError(400, "答案选项不正确");
      }
      statements.push(env.DB.prepare(
        `UPDATE mock_exam_items SET selected_json = ?, answered_at = CASE WHEN ? = '[]' THEN NULL ELSE datetime('now') END
         WHERE id = ? AND exam_id = ?
           AND EXISTS (SELECT 1 FROM mock_exams WHERE id = ? AND user_id = ? AND status = 'in_progress')`
      ).bind(JSON.stringify(answers), JSON.stringify(answers), itemId, examId, examId, user.id));
    }
    if (body.marked !== undefined) {
      if (typeof body.marked !== "boolean") throw new ApiError(400, "标记状态不正确");
      statements.push(env.DB.prepare(
        `UPDATE mock_exam_items SET marked = ? WHERE id = ? AND exam_id = ?
         AND EXISTS (SELECT 1 FROM mock_exams WHERE id = ? AND user_id = ? AND status = 'in_progress')`
      ).bind(body.marked ? 1 : 0, itemId, examId, examId, user.id));
    }
  }
  let remainingSeconds = exam.remaining_seconds;
  if (body.remainingSeconds !== undefined) {
    const requested = Number(body.remainingSeconds);
    if (!Number.isInteger(requested) || requested < 0) throw new ApiError(400, "剩余时间不正确");
    remainingSeconds = Math.min(exam.remaining_seconds, requested, 7200);
  }
  let currentItemId = exam.current_item_id;
  if (body.currentItemId !== undefined) {
    if (typeof body.currentItemId !== "string") throw new ApiError(400, "当前题目不正确");
    const currentExists = await env.DB.prepare("SELECT id FROM mock_exam_items WHERE id = ? AND exam_id = ?").bind(body.currentItemId, examId).first();
    if (!currentExists) throw new ApiError(400, "当前题目不属于该模拟题");
    currentItemId = body.currentItemId;
  }
  let currentSection = exam.current_section;
  if (body.currentSection !== undefined) {
    if (body.currentSection !== "single" && body.currentSection !== "multiple") throw new ApiError(400, "答题分区不正确");
    currentSection = body.currentSection;
  }
  statements.push(env.DB.prepare(
    `UPDATE mock_exams SET remaining_seconds = ?, current_item_id = ?, current_section = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'in_progress'`
  ).bind(remainingSeconds, currentItemId, currentSection, examId, user.id));
  await env.DB.batch(statements);
  return apiJson({ ok: true, remainingSeconds });
}

async function submitMockExam(request: Request, env: Env, user: User, examId: string): Promise<Response> {
  const exam = await requireOwnedMockExam(env, user, examId);
  if (exam.status === "submitted") return apiJson({ exam: mapMockExamSummary(exam) });
  const body = await readJson<{ remainingSeconds?: unknown; responses?: unknown }>(request);
  let remainingSeconds = exam.remaining_seconds;
  if (body.remainingSeconds !== undefined) {
    const requested = Number(body.remainingSeconds);
    if (!Number.isInteger(requested) || requested < 0) throw new ApiError(400, "剩余时间不正确");
    remainingSeconds = Math.min(remainingSeconds, requested, 7200);
  }
  const rows = await env.DB.prepare(
    "SELECT id, type, options_json, answer_json, selected_json, marked FROM mock_exam_items WHERE exam_id = ? ORDER BY position"
  ).bind(examId).all<{ id: string; type: "single" | "multiple"; options_json: string; answer_json: string; selected_json: string | null; marked: number }>();
  if (rows.results.length !== 75) throw new ApiError(409, "模拟题数据不完整，暂时无法交卷");
  const submittedById = new Map<string, { answers: string[]; marked: boolean }>();
  if (body.responses !== undefined) {
    if (!Array.isArray(body.responses) || body.responses.length !== rows.results.length) throw new ApiError(400, "交卷答题数据不完整");
    const itemsById = new Map(rows.results.map((item) => [item.id, item]));
    for (const value of body.responses) {
      const response = inputRecord(value);
      const itemId = typeof response.itemId === "string" ? response.itemId : "";
      const item = itemsById.get(itemId);
      if (!item || submittedById.has(itemId) || !Array.isArray(response.answers) || response.answers.some((answer) => typeof answer !== "string") || typeof response.marked !== "boolean") {
        throw new ApiError(400, "交卷答题数据不正确");
      }
      const answers = normalizeAnswers(response.answers);
      const options = JSON.parse(item.options_json) as Record<string, string>;
      if (answers.some((answer) => !(answer in options)) || (item.type === "single" && answers.length > 1)) throw new ApiError(400, "交卷答案选项不正确");
      submittedById.set(itemId, { answers, marked: response.marked });
    }
  }
  const submissions = rows.results.map((item) => submittedById.get(item.id) ?? {
    answers: normalizeAnswers(item.selected_json ? JSON.parse(item.selected_json) : []),
    marked: Boolean(item.marked)
  });
  const answeredCount = submissions.filter((item) => item.answers.length > 0).length;
  const markedCount = submissions.filter((item) => item.marked).length;
  const { score, wrongCount, passed } = scoreMockExam(rows.results.map((item, index) => ({
    type: item.type,
    submitted: submissions[index].answers,
    expected: JSON.parse(item.answer_json)
  })));
  const statements: D1PreparedStatement[] = [];
  if (submittedById.size) {
    rows.results.forEach((item, index) => {
      const submission = submissions[index];
      const answers = JSON.stringify(submission.answers);
      statements.push(env.DB.prepare(
        `UPDATE mock_exam_items SET selected_json = ?, marked = ?,
          answered_at = CASE WHEN ? = '[]' THEN NULL ELSE datetime('now') END
         WHERE id = ? AND exam_id = ?`
      ).bind(answers, submission.marked ? 1 : 0, answers, item.id, examId));
    });
  }
  statements.push(env.DB.prepare(
    `UPDATE mock_exams SET status = 'submitted', remaining_seconds = ?, score = ?, passed = ?, wrong_count = ?,
      submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'in_progress'`
  ).bind(remainingSeconds, score, passed ? 1 : 0, wrongCount, examId, user.id));
  await env.DB.batch(statements);
  return apiJson({ exam: { ...mapMockExamSummary({ ...exam, answeredCount, markedCount }), status: "submitted", remainingSeconds, score, passed, wrongCount, submittedAt: new Date().toISOString() } });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/health" && method === "GET") return apiJson({ ok: true });
  if (path === "/api/auth/register" && method === "POST") return register(request, env);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if ((path === "/api/auth/bootstrap-registration-code" || path === "/api/auth/bootstrap-invite") && method === "POST") return bootstrapInvite(request, env);

  const user = await requireUser(request, env);
  if (path === "/api/auth/me" && method === "GET") return apiJson({ user });
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/account" && method === "PATCH") return updateAccount(request, env, user);
  if (path === "/api/meta" && method === "GET") return getMeta(env);
  if (path === "/api/stats" && method === "GET") return getStats(env, user);
  if (path === "/api/questions" && method === "GET") return getQuestions(request, env, user);
  if (path === "/api/practice/cursor" && method === "PATCH") return updatePracticeCursor(request, env, user);
  if (path === "/api/mock-exams" && method === "GET") return getMockExamCatalog(env, user);
  if (path === "/api/mock-exams" && method === "POST") return createMockExam(request, env, user);
  const mockSubmitMatch = path.match(/^\/api\/mock-exams\/([^/]+)\/submit$/);
  if (mockSubmitMatch && method === "POST") return submitMockExam(request, env, user, decodeURIComponent(mockSubmitMatch[1]));
  const mockExamMatch = path.match(/^\/api\/mock-exams\/([^/]+)$/);
  if (mockExamMatch && method === "GET") return getMockExam(env, user, decodeURIComponent(mockExamMatch[1]));
  if (mockExamMatch && method === "PATCH") return updateMockExamProgress(request, env, user, decodeURIComponent(mockExamMatch[1]));
  if (path === "/api/invites" && (method === "GET" || method === "POST")) {
    requireAdmin(user);
    return method === "GET" ? getRegistrationCodes(env) : createRegistrationCode(env, user);
  }

  if (path.startsWith("/api/admin/")) {
    requireAdmin(user);
    if (path === "/api/admin/questions" && method === "GET") return getAdminQuestions(request, env);
    if (path === "/api/admin/questions/import" && method === "POST") return importQuestions(request, env);
    if (path === "/api/admin/questions/bulk-status" && method === "POST") return updateAdminQuestionsStatus(request, env);
    if (path === "/api/admin/users" && method === "GET") return getAdminUsers(request, env);
    if (path === "/api/admin/registration-codes" && method === "GET") return getRegistrationCodes(env);
    if (path === "/api/admin/registration-codes" && method === "POST") return createRegistrationCode(env, user);
    if (path === "/api/admin/mock-templates" && method === "GET") return getAdminMockTemplates(env);
    const mockTemplateMatch = path.match(/^\/api\/admin\/mock-templates\/([1-6])$/);
    if (mockTemplateMatch && method === "PUT") return uploadMockTemplate(request, env, user, mockTemplateMatch[1]);
    const adminQuestionMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
    if (adminQuestionMatch && method === "PATCH") {
      return updateAdminQuestion(request, env, decodeURIComponent(adminQuestionMatch[1]));
    }
    const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && method === "PATCH") {
      return updateAdminUser(request, env, user, decodeURIComponent(adminUserMatch[1]));
    }
  }

  const answerMatch = path.match(/^\/api\/questions\/([^/]+)\/answer$/);
  if (answerMatch && method === "POST") return submitAnswer(request, env, user, decodeURIComponent(answerMatch[1]));
  const markMatch = path.match(/^\/api\/questions\/([^/]+)\/mark$/);
  if (markMatch && method === "POST") return updateMark(request, env, user, decodeURIComponent(markMatch[1]));
  throw new ApiError(404, "接口不存在");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof ApiError) return apiJson({ error: error.message }, error.status);
      console.error("Unhandled API error", error);
      return apiJson({ error: "服务暂时不可用，请稍后重试" }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
