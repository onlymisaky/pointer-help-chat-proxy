> 由于 pointer 对接口增加了人机验证(x-is-human，x-kpsdk-* 等)，虽然那可以通过 puppeteer、playwright 等工具来模拟，但是可用的模型也降级到了只能使用 Claude 3.5 Sonnet ，所以这个项目也就没有意义了。

# pointer-help-chat-proxy

一个基于 `Fastify + TypeScript` 的兼容层服务，用统一的上游 `/api/chat` SSE 接口，对外模拟多套常见大模型 API。

当前已支持：

- OpenAI `POST /v1/chat/completions`
- OpenAI `POST /v1/responses`
- Claude `POST /v1/messages`
- Gemini `POST /v1beta/models/:modelAction`
- 健康检查 `GET /health`

这个项目的核心目标是“输入输出格式兼容”，不是直连官方模型服务。所有请求最终都会被转发到固定上游：`https://pointer.com/api/chat`


## 特性

- 统一代理 OpenAI、Claude、Gemini 三套常见文本接口
- 支持非流式 JSON 和 SSE 流式输出
- 内置协议转换，自动把上游 SSE 事件映射为对应平台格式
- 统一彩色日志，便于查看转换前后请求与响应
- 构建时自动复制 `.env` 到 `dist/.env`
- 已接入 `@antfu/eslint-config`

## 环境要求

- Node.js 18+
- npm

## 安装

```bash
npm install
```

## 运行

开发模式，带热更新：

```bash
npm run dev
```

构建：

```bash
npm run build
```

运行构建产物：

```bash
npm start
```

代码检查：

```bash
npm run lint
npm run lint:fix
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=3000`

## `.env` 配置

这个项目不会用 `.env` 来配置上游 URL，上游地址已经写死在代码里。`.env` 只用于补充代理请求头。

配置格式：

```bash
headers={"cookie":"your-cookie","x-example":"value"}
```

说明：

- `headers` 需要是一个合法 JSON 对象字符串
- `.env` 中的 header 会和代码中的默认 header 合并
- 同名字段会覆盖默认值
- 运行构建产物时优先读取 `dist/.env`
- 如果 `dist/.env` 不存在，会回退到项目根目录 `.env`

## 接口列表

### Health

```bash
GET /health
```

返回：

```bash
{"ok":true}
```

### OpenAI Chat Completions

```bash
POST /v1/chat/completions
```

支持的核心字段：

- `model`
- `messages`
- `stream`

示例：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.1",
    "messages": [
      { "role": "user", "content": "你好" }
    ]
  }'
```

流式示例：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.1",
    "stream": true,
    "messages": [
      { "role": "user", "content": "写一个 hello world" }
    ]
  }'
```

### OpenAI Responses

```bash
POST /v1/responses
```

支持的核心字段：

- `model`
- `input`
- `stream`

示例：

```bash
curl http://localhost:3000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.1",
    "input": "介绍一下你自己"
  }'
```

### Claude Messages

```bash
POST /v1/messages
```

支持的核心字段：

- `model`
- `system`
- `messages`
- `stream`

示例：

```bash
curl http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [
      { "role": "user", "content": "帮我写一个摘要" }
    ]
  }'
```

### Gemini

Gemini 通过单一路由分发两种动作：

```bash
POST /v1beta/models/:model:generateContent
POST /v1beta/models/:model:streamGenerateContent
```

支持的核心字段：

- `contents`
- `systemInstruction`
- `generationConfig`

非流式示例：

```bash
curl http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "用一句话解释 SSE" }]
      }
    ]
  }'
```

流式示例：

```bash
curl http://localhost:3000/v1beta/models/gemini-2.5-pro:streamGenerateContent \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "给我一个 TypeScript 示例" }]
      }
    ]
  }'
```

## 模型映射

对外传入的 `model` 不会原样透传到上游，而是会映射到固定上游模型：

- OpenAI / GPT / Codex 关键词 -> `openai/gpt-5.1-codex-mini`
- Claude / Anthropic / Opus 关键词 -> `anthropic/claude-sonnet-4.6`
- Gemini / Google 关键词 -> `google/gemini-3-flash`
- 未识别模型默认走 `openai/gpt-5.1-codex-mini`

## 日志

服务包含两类日志：

- Fastify 请求生命周期日志
- 协议转换日志

转换日志格式：

```bash
[HH:mm:ss] ↑请求 before
[HH:mm:ss] ↑请求 after
[HH:mm:ss] ↓响应 before
[HH:mm:ss] ↓响应 after
```

说明：

- `↑请求 before`：收到的原始请求体
- `↑请求 after`：最终发送给上游的“最新一条用户文本”
- `↓响应 before`：上游聚合后的最终回复文本
- `↓响应 after`：返回给调用方的最终协议响应

日志带颜色，并会对 JSON 做格式化换行。

## 项目结构

```bash
src/
  routes/       各协议路由与协议映射
  services/     上游代理转发
  types/        共享类型定义
  utils/        日志、SSE、响应、消息、提示词、env 工具
scripts/
  copy-env.mjs  构建后复制 .env 到 dist
```

## 已知限制

- 当前只支持文本主路径，不是完整官方 API 的全量实现
- 不做代理鉴权
- 不代理多模态输入输出
- 上游 URL 固定写死，不支持通过配置切换
- `tsconfig.json` 只编译 `src/**/*.ts`
- 这个项目没有测试代码

## License

仅供内部或个人项目使用，按你的实际需求自行补充。
