# 题序 · ACP 题库

面向 Cloudflare Workers + D1 的移动端优先刷题系统。支持全量题库、核心题库、单选/多选专项、知识分类和文字搜索；答错自动加入错题本，并提供到期复习、高频错题、随机抽查和全部重做。

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

打开 `http://localhost:5173`。本地演示邀请码为 `ACP-DEMO-2026`，只存在于 `seed.local.sql`，不会随生产迁移部署。

## 题目格式与导入

题目字段沿用 `lizi.md`：

| 字段 | 含义 |
| --- | --- |
| `i` | 原题编号 |
| `t` | `单选题` 或 `多选题` |
| `q` | 题干 |
| `o` | 选项对象，如 `{ "A": "..." }` |
| `a` | 正确答案数组 |
| `e` | 答案解析 |
| `k` | 知识分类 |
| `core` | 是否为核心题 |
| `r` | 参考资料链接 |

导入脚本支持 JSON 数组、单个 JSON 对象，或连续存放的多个 JSON 对象：

```bash
node scripts/questions-to-sql.mjs questions.md migrations/0003_questions.sql
npm run db:migrate:local
```

确认本地数据后，再执行远程迁移。脚本使用题目 `i` 生成稳定 ID，重复导入会更新现有题目。

## Cloudflare 部署

1. 登录 Wrangler 并创建 D1：

```bash
npx wrangler login
npx wrangler d1 create acp-question
```

2. 将命令返回的 `database_id` 写入 `wrangler.jsonc`，替换全零占位 ID。

3. 设置一次性的初始化令牌：

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

4. 应用数据库迁移并部署：

```bash
npm run db:migrate:remote
npm run deploy
```

5. 在第一个用户注册前生成初始邀请码：

```bash
curl -X POST https://你的域名/api/auth/bootstrap-invite \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的 BOOTSTRAP_TOKEN"}'
```

初始邀请码 24 小时内有效且只能使用一次。第一个注册用户自动成为管理员；已有用户后，初始化接口会永久关闭。登录用户最多可同时生成 5 个未使用的邀请码，每个邀请码 30 天内可注册一个账户。

## 数据与安全

- 密码使用 PBKDF2-SHA256 和独立随机盐保存，不存储明文。
- 登录使用 30 天有效的 HttpOnly、SameSite Cookie，服务端只保存令牌哈希。
- 题目列表和搜索接口不返回答案或解析；提交后才返回判定和解析。
- 答错自动加入错题本。错题连续答对两次后自动标记为已掌握，手动加入的错题需手动移出。
- D1 迁移位于 `migrations/`，本地数据位于 Wrangler 的 `.wrangler/` 目录。

## 常用命令

```bash
npm run build             # 类型检查与生产构建
npm test                  # 单元测试
npm run db:migrate:local  # 本地 D1 迁移
npm run db:migrate:remote # 远程 D1 迁移
npm run deploy            # 构建并发布 Worker
```
