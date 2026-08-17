import { isAnswerCorrect, nextReviewDate, normalizeAnswers, normalizeQuestionType } from "../shared/quiz";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOOTSTRAP_TOKEN?: string;
}

interface User {
  id: string;
  username: string;
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
    `SELECT u.id, u.username, u.role
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

function validateCredentials(usernameRaw: unknown, passwordRaw: unknown): { username: string; password: string } {
  const username = validateUsername(usernameRaw);
  const password = validatePassword(passwordRaw);
  return { username, password };
}

async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown; inviteCode?: unknown }>(request);
  const { username, password } = validateCredentials(body.username, body.password);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";
  if (!inviteCode) throw new ApiError(400, "请输入邀请码");

  const invite = await env.DB.prepare(
    `SELECT id FROM invite_codes
     WHERE code = ? COLLATE NOCASE AND disabled = 0 AND use_count < max_uses
       AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).bind(inviteCode).first<{ id: string }>();
  if (!invite) throw new ApiError(400, "邀请码无效、已用完或已过期");

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const userId = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, username, passwordHash, salt, count?.count === 0 ? "admin" : "member"),
      env.DB.prepare("INSERT INTO invite_redemptions (invite_id, user_id) VALUES (?, ?)").bind(invite.id, userId),
      env.DB.prepare("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses")
        .bind(invite.id)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) throw new ApiError(409, "用户名已被使用");
    if (message.includes("INVITE_UNAVAILABLE")) throw new ApiError(409, "邀请码刚刚已被使用，请换一个邀请码");
    throw error;
  }
  const cookie = await createSession(request, env, userId);
  return apiJson({ user: { id: userId, username, role: count?.count === 0 ? "admin" : "member" } }, 201, { "Set-Cookie": cookie });
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const { username, password } = validateCredentials(body.username, body.password);
  const account = await env.DB.prepare(
    "SELECT id, username, password_hash, password_salt, role, disabled FROM users WHERE username = ? COLLATE NOCASE"
  ).bind(username).first<User & { password_hash: string; password_salt: string; disabled: number }>();
  const calculated = await hashPassword(password, account?.password_salt ?? randomToken(16));
  if (!account || !constantTimeEqual(calculated, account.password_hash)) throw new ApiError(401, "用户名或密码不正确");
  if (account.disabled) throw new ApiError(403, "该账户已被管理员禁用");
  const cookie = await createSession(request, env, account.id);
  return apiJson({ user: { id: account.id, username: account.username, role: account.role } }, 200, { "Set-Cookie": cookie });
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
  if (!env.BOOTSTRAP_TOKEN) throw new ApiError(404, "未启用初始邀请码接口");
  const body = await readJson<{ token?: unknown }>(request);
  const token = typeof body.token === "string" ? body.token : "";
  if (!constantTimeEqual(token.padEnd(env.BOOTSTRAP_TOKEN.length, "\0").slice(0, env.BOOTSTRAP_TOKEN.length), env.BOOTSTRAP_TOKEN)) {
    throw new ApiError(403, "初始化令牌不正确");
  }
  const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if ((users?.count ?? 0) > 0) throw new ApiError(409, "已有用户，初始邀请码接口已关闭");
  const existing = await env.DB.prepare(
    "SELECT code FROM invite_codes WHERE disabled = 0 AND use_count < max_uses AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1"
  ).first<{ code: string }>();
  if (existing) return apiJson({ inviteCode: existing.code });
  const code = createInviteCode();
  await env.DB.prepare(
    "INSERT INTO invite_codes (id, code, max_uses, expires_at) VALUES (?, ?, 1, datetime('now', '+1 day'))"
  ).bind(crypto.randomUUID(), code).run();
  return apiJson({ inviteCode: code }, 201);
}

async function updateAccount(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ username?: unknown; currentPassword?: unknown; newPassword?: unknown }>(request);
  const hasUsername = body.username !== undefined;
  const hasPassword = body.newPassword !== undefined;
  if (!hasUsername && !hasPassword) throw new ApiError(400, "没有需要更新的账户信息");

  const username = hasUsername ? validateUsername(body.username) : user.username;
  const statements: D1PreparedStatement[] = [];
  if (username !== user.username) {
    statements.push(env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username, user.id));
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

  try {
    if (statements.length) await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new ApiError(409, "用户名已被使用");
    throw error;
  }
  return apiJson({ user: { ...user, username }, passwordChanged: hasPassword });
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
    conditions.push("u.username LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLike(search)}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.disabled, u.created_at AS createdAt,
      COUNT(a.id) AS attempts, COALESCE(SUM(a.is_correct), 0) AS correct,
      COUNT(DISTINCT a.question_id) AS practiced,
      COALESCE((SELECT SUM(m.active = 1) FROM mistakes m WHERE m.user_id = u.id), 0) AS activeMistakes
     FROM users u LEFT JOIN attempts a ON a.user_id = u.id ${where}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all<Record<string, unknown>>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).bind(...values).first<{ count: number }>();
  return apiJson({
    users: rows.results.map((row) => ({
      id: String(row.id),
      username: String(row.username),
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
    "SELECT id, username, role, disabled FROM users WHERE id = ?"
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
  return apiJson({ user: { id: target.id, username: target.username, role, disabled } });
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

async function getQuestions(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const type = url.searchParams.get("type") ?? "all";
  const category = (url.searchParams.get("category") ?? "").trim();
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80);
  const review = url.searchParams.get("review") ?? "sequence";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 40, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions = ["q.active = 1"];
  const values: unknown[] = [user.id, user.id];
  if (scope === "core") conditions.push("q.is_core = 1");
  else if (scope === "wrong") conditions.push("m.active = 1");
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
  if (review === "random") order = "RANDOM()";
  else if (scope === "wrong" && review === "frequency") order = "m.wrong_count DESC, m.last_wrong_at DESC";
  else if (scope === "wrong" && review === "due") order = "COALESCE(m.next_review_at, m.last_wrong_at), m.wrong_count DESC";
  else if (review !== "sequence") throw new ApiError(400, "未知的出题顺序");

  const from = `FROM questions q
    LEFT JOIN user_progress p ON p.question_id = q.id AND p.user_id = ?
    LEFT JOIN mistakes m ON m.question_id = q.id AND m.user_id = ?
    WHERE ${conditions.join(" AND ")}`;
  const rows = await env.DB.prepare(
    `SELECT q.id, q.source_id, q.type, q.question, q.options_json, q.category, q.is_core,
      p.attempt_count, p.last_is_correct,
      CASE WHEN m.active = 1 THEN 1 ELSE 0 END AS is_marked,
      m.wrong_count, m.next_review_at
     ${from} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all<QuestionRow>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...values).first<{ count: number }>();
  return apiJson({ questions: rows.results.map(mapQuestion), total: total?.count ?? 0 });
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
      `SELECT SUM(active = 1) AS active,
       SUM(active = 1 AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))) AS due
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

async function getInvites(env: Env, user: User): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT code, max_uses AS maxUses, use_count AS useCount, expires_at AS expiresAt, created_at AS createdAt
     FROM invite_codes WHERE creator_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(user.id).all();
  return apiJson({ invites: rows.results });
}

async function createInvite(env: Env, user: User): Promise<Response> {
  const unused = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM invite_codes WHERE creator_id = ? AND disabled = 0 AND use_count < max_uses AND expires_at > datetime('now')"
  ).bind(user.id).first<{ count: number }>();
  if ((unused?.count ?? 0) >= 5) throw new ApiError(429, "最多同时保留 5 个未使用的邀请码");
  const code = createInviteCode();
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO invite_codes (id, code, creator_id, max_uses, expires_at) VALUES (?, ?, ?, 1, datetime(?))"
  ).bind(crypto.randomUUID(), code, user.id, expiresAt).run();
  return apiJson({ invite: { code, maxUses: 1, useCount: 0, expiresAt, createdAt: new Date().toISOString() } }, 201);
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/health" && method === "GET") return apiJson({ ok: true });
  if (path === "/api/auth/register" && method === "POST") return register(request, env);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/bootstrap-invite" && method === "POST") return bootstrapInvite(request, env);

  const user = await requireUser(request, env);
  if (path === "/api/auth/me" && method === "GET") return apiJson({ user });
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/account" && method === "PATCH") return updateAccount(request, env, user);
  if (path === "/api/meta" && method === "GET") return getMeta(env);
  if (path === "/api/stats" && method === "GET") return getStats(env, user);
  if (path === "/api/questions" && method === "GET") return getQuestions(request, env, user);
  if (path === "/api/invites" && method === "GET") return getInvites(env, user);
  if (path === "/api/invites" && method === "POST") return createInvite(env, user);

  if (path.startsWith("/api/admin/")) {
    requireAdmin(user);
    if (path === "/api/admin/questions" && method === "GET") return getAdminQuestions(request, env);
    if (path === "/api/admin/questions/import" && method === "POST") return importQuestions(request, env);
    if (path === "/api/admin/users" && method === "GET") return getAdminUsers(request, env);
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
