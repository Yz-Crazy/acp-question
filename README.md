# 题序 · ACP 题库

面向 Cloudflare Workers + D1 的移动端优先刷题系统。支持全量题库、核心题库、单选/多选专项、知识分类和文字搜索；答错自动加入错题本，并提供到期复习、高频错题、随机抽查和全部重做。用户可以修改用户名和密码，管理员可以在线更新题库并管理用户状态与角色。

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

2. 将命令返回的 `database_id` 设置为部署环境变量。不要直接修改 `wrangler.jsonc`：

```bash
export D1_DATABASE_ID="你的 D1 database_id"
```

GitHub Actions、Cloudflare Builds 等 CI 环境中也需要配置同名变量，并将部署命令设置为 `npm run deploy`。Wrangler 不会直接展开配置文件里的环境变量；项目脚本会校验该值，并临时替换 `wrangler.jsonc` 中的 `${D1_DATABASE_ID}`，生成的配置不会提交或保留在工作区。

3. 设置一次性的初始化令牌：

```bash
node scripts/run-wrangler.mjs secret put BOOTSTRAP_TOKEN
```

4. 应用数据库迁移并部署：

```bash
npm run db:migrate:remote
npm run deploy:check
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
- 用户修改密码后保留当前会话，其他设备会话立即失效。
- 题目列表和搜索接口不返回答案或解析；提交后才返回判定和解析。
- 答错自动加入错题本。错题连续答对两次后自动标记为已掌握，手动加入的错题需手动移出。
- 被禁用用户的全部会话立即失效；管理员不能禁用或降级自己，系统至少保留一个有效管理员。
- D1 迁移位于 `migrations/`，本地数据位于 Wrangler 的 `.wrangler/` 目录。

## 管理员功能

第一个注册用户自动成为管理员。管理员登录后可从侧栏或“我的”页面进入系统管理：

- 合并导入题库，只新增或更新文件中包含的题目。
- 覆盖导入题库，将文件中未包含的旧题标记为停用。
- 编辑单题的题型、题干、选项、答案、解析、分类、核心状态和启用状态。
- 搜索用户、调整学习者/管理员角色，以及启用或禁用账户。

在线题库导入单次最多 500 道题，导入前会完整校验所有题目；任何一道题校验失败时都不会写入数据库。

## 常用命令

```bash
npm run build             # 类型检查与生产构建
npm test                  # 单元测试
npm run db:migrate:local  # 本地 D1 迁移
npm run db:migrate:remote # 远程 D1 迁移
npm run deploy            # 构建并发布 Worker
```
