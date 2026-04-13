> 由于 pointer 对接口增加了人机验证(x-is-human，x-kpsdk-* 等)，虽然那可以通过 puppeteer、playwright 等工具来模拟，但是可用的模型也降级到了只能使用 Claude 3.5 Sonnet ，所以这个项目也就没有意义了。

# pointer-help-chat-proxy

一个基于 `Fastify + TypeScript` 的兼容层服务，用统一的上游 `/api/chat` SSE 接口，对外提供多套常见大模型 API 的基础文本兼容。

当前已支持：

- OpenAI `POST /v1/chat/completions`
- OpenAI `POST /v1/responses`
- Claude `POST /v1/messages`
- Gemini `POST /v1beta/models/:modelAction`
- 健康检查 `GET /health`

这个项目的核心目标是“让基础纯文本调用可以接入统一上游”，不是直连官方模型服务，也不是 OpenAI / Claude / Gemini 官方协议的完整实现。所有请求最终都会转发到固定上游：`https://cursor.com/api/chat`

如果你需要的是严格的官方 API 等价行为，这个项目并不适合。它当前只覆盖最常见的文本问答场景。


## 特性

- 提供 OpenAI、Claude、Gemini 三套常见文本接口的最小兼容层
- 支持基础文本场景下的非流式 JSON 和 SSE 流式输出
- 内置协议转换，自动把上游 SSE 事件映射为目标平台的基础文本格式
- 统一彩色日志，便于查看转换前后请求与响应
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

当前支持的核心字段：

- `model`
- `messages`
- `stream`

当前只保证纯文本消息场景可用：

- `messages[].content` 适合传字符串或可归一化为文本的简单内容
- 示例仅适用于基础问答，不适用于多模态、工具调用或严格依赖官方字段的 SDK

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

当前支持的核心字段：

- `model`
- `input`
- `stream`

当前只保证纯文本输入场景可用：

- `input` 适合传字符串，或可提取出文本内容的简单消息数组
- 流式输出只实现最小文本事件子集，不保证与 OpenAI 官方 Responses SSE 事件序列完全一致
- 示例仅适用于基础问答，不适用于多模态、工具调用或严格依赖官方字段的 SDK

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

当前支持的核心字段：

- `model`
- `system`
- `messages`
- `stream`

当前只保证纯文本消息场景可用：

- `system` 只适合传可提取为文本的简单内容，并会进入统一消息流处理
- `messages[].content` 适合传字符串或可归一化为文本的简单内容
- 流式输出只实现基础文本事件子集，不保证与 Claude 官方完整 SSE 事件序列和全部字段完全一致
- 示例仅适用于基础问答，不适用于多模态、工具调用或严格依赖官方字段的 SDK

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

当前支持的核心字段：

- `contents`
- `systemInstruction`
- `generationConfig`

当前只保证纯文本输入场景可用：

- 仅支持 `:generateContent` 和 `:streamGenerateContent` 两个动作
- `contents[].parts` 适合传文本 part，非文本 part 不保证兼容
- `systemInstruction` 只适合传可提取为文本的简单结构，并会进入统一消息流处理
- 流式输出只实现最小文本增量，不保证与 Gemini 官方完整流式响应结构完全一致
- 示例仅适用于基础问答，不适用于多模态、工具调用或严格依赖官方字段的 SDK

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

这意味着请求里的 `model` 更接近“路由信号”，而不是实际调用的官方模型标识。

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
```

## 已知限制

- 当前只支持文本主路径，不是完整官方 API 的全量实现
- OpenAI 风格接口只覆盖基础文本子集，不保证与官方 schema 完全一致
- `system`、`developer`、`tool`、`function` 等非基础消息角色不保证按 OpenAI 原语义完整保留
- 非文本 `content` / `input`，例如图片、音频、工具调用相关结构，不保证兼容，可能被忽略或被转成纯文本
- `/v1/responses` 的 SSE 流只覆盖最小文本事件子集，不保证包含官方完整事件序列和全部字段
- 返回体只覆盖基础文本响应字段，不保证满足严格 schema 校验客户端的全部字段要求
- 错误对象为简化版本，不保证与官方错误类型、错误码和字段完全一致
- `model` 会映射到固定上游模型，不能把这里的行为视为对应官方模型的真实行为
- Claude Messages 接口只覆盖基础文本子集，不是 Claude 官方协议的完整实现
- Claude 的 `system` 会转为统一消息流中的文本输入，不保证保留原始 system 指令语义
- Claude 的 `messages[].role` 不保证完整保留所有角色语义；除 `assistant` 外的其他角色会按普通用户输入处理
- Claude 的非文本内容块不保证兼容，可能被忽略或转成纯文本
- Claude 的流式输出仅适用于基础文本增量展示，不保证与官方 SSE 事件序列完全一致
- Gemini 接口只覆盖文本主路径，不是 Gemini 官方 API 的完整实现
- Gemini 仅支持 `generateContent` 和 `streamGenerateContent` 两个动作
- Gemini 的 `contents[].parts` 中非文本内容不保证兼容，可能被忽略
- Gemini 的 `systemInstruction` 会被转成普通文本消息处理，不保证保留官方 system 指令语义
- Gemini 的流式输出仅提供基础文本增量，不保证与官方完整流式响应结构完全一致
- Gemini 返回体只覆盖 `candidates` / `usageMetadata` 的基础字段，不保证满足严格 schema 校验客户端的全部要求
- 不做代理鉴权
- 不代理多模态输入输出
- 上游 URL 固定写死，不支持通过配置切换
- `tsconfig.json` 只编译 `src/**/*.ts`
- 这个项目没有测试代码

## 适用场景

适合：

- 简单文本对话
- 轻量 OpenAI 风格联调
- 只依赖基础请求字段和基础文本输出的自定义客户端

不适合：

- 严格依赖 OpenAI 官方 SDK 完整协议行为的场景
- 严格依赖 Claude 或 Gemini 官方 SDK / 官方响应结构的场景
- 多模态输入输出
- 工具调用 / 函数调用
- 严格依赖 `/v1/responses`、Claude SSE、Gemini 流式响应官方事件序列的客户端

## License

仅供内部或个人项目使用，按你的实际需求自行补充。
