# 高中化学练习台

人教版（浙江高考）高中化学在线练习应用。

## 功能

- **闯关模式**：按模块自动分关（每关 10 题），达标 60% 解锁下一关；模块全部小关通关 +20 分并解锁下一模块
- **计时刷题**：1~10 分钟限时挑战，每个时长保留 TOP5 成绩记录
- **错题本**：自动收集错题，支持「全部 / 知识点 / 实验」筛选和重练
- **积分与段位**：首次答对 +5 分、通关 +20 分（重复答对不重复给分）；按掌握度划分段位（青铜→钻石）
- **云端同步**：注册 / 登录后多端同步（records / points / levels / rewards / flash / practice / timed 七类数据，按时间戳 last-write-wins）

## 本地开发

```bash
# 方式一：纯前端（无后端，数据仅存内存，刷新即失，适合改 UI）
python3 -m http.server 8000

# 方式二：完整后端（Pages Functions + 本地 D1）
npx wrangler d1 execute chem-db --local --file=./schema.sql   # 首次建表
npx wrangler pages dev . --port 8788
```

注意：方式二直接用 `npx wrangler pages dev .` 即可，D1 绑定会从 `wrangler.toml` 读取；不要额外传 `--d1` 参数（会覆盖绑定指向另一份空库）。

## 部署

1. 部署到 Cloudflare Pages（git 连动部署，或 `npx wrangler pages deploy .`）
2. 首次部署后初始化远端数据库：

```bash
npx wrangler d1 execute chem-db --remote --file=./schema.sql
```

## 维护题库

1. 编辑 `bank.js`，按现有格式添加题目：`{ id, module, q, options[], answer, explain }`
   - `id` 全库唯一：knowledge 用 `k` 前缀，experiment 用 `e` 前缀
   - `module` 必须与 `index.html` 中 `MODULES` 列出的模块名**逐字一致**（knowledge：必修一·基本概念 / 必修二 / 选择性必修1·反应原理 / 选择性必修2·物质结构与性质 / 选择性必修3·有机化学；experiment：必修一 / 必修二 / 选择性必修1 / 选择性必修2 / 选择性必修3）
2. 跑校验：`node check-bank.mjs`（检查 id 重复、答案索引越界、缺解析、模块名不匹配等）
3. 关卡按模块自动生成，无需额外配置

## 账户规则

- 用户名 3–20 位字母 / 数字 / 下划线（`^[a-zA-Z0-9_]{3,20}$`）
- 密码任意；前端只传 cyrb53 派生值，服务器 scrypt 加盐哈希存储，Bearer token 有效期 30 天，**活跃使用自动续期**（剩余不足一半时顺延完整周期，15 天内至少同步一次即不会被登出）；**登出会吊销服务端会话**
- **token 过期后自动登出**：过期后的首次同步收到 401，前端自动清除本地会话并弹出登录框提示「登录已过期」；云端数据不受影响，重新登录即恢复同步
- 登录不存在的用户名会提示「用户不存在」，**不会自动注册**；注册需点击「去注册」显式创建

## 已知限制

- 同步按 key 整体覆盖（last-write-wins）：两台设备交替使用时，后推送的设备会整键覆盖先推送的；服务器不再比较客户端时间戳（时钟偏慢不再被拒收），但"旧数据晚到覆盖新数据"仍需用户自行避免
- `sessions` 表过期会话在每次登录/注册时顺带清理，此前积累的过期行不会被自动删除
- 题目删除功能当前隐藏（`isDev()` 恒为 false）
