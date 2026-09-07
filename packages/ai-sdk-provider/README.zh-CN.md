# @runjobsai/ai-sdk-provider

[English](./README.md) · **简体中文**

[RunJobs AI Gateway](https://github.com/runjobsai/ai-gateway) 的 [Vercel AI SDK](https://ai-sdk.dev) provider,基于 [`@runjobsai/sdk`](https://github.com/runjobsai/sdk-js) 构建。

runjobs 目录中的全部模型(Claude、GPT、Gemini、DeepSeek、Qwen、MiniMax、GLM、Grok)均可通过 `generateText`、`streamText`、`generateObject`、`Agent`、`useChat` 以及 AI SDK 生态的其余部分调用。

## 与 `@ai-sdk/openai-compatible` 的关系

网关实现了 OpenAI Chat Completions 协议,因此标准的 OpenAI 兼容 provider 可以直接对接,前提是已经签发了 `rk_…` 形式的 API key。

该前提正是本包所要解决的限制。API key 无法随浏览器 bundle 一同分发,通常的做法是通过自建后端代理请求,这使得纯静态的客户端应用不再可能。

使用 `authProvider: "runjobs"` 时,不涉及任何 API key:

```ts
const runjobs = createRunJobs({ authProvider: "runjobs" });
```

SDK 会完成 runjobs.ai 的授权握手,持久化所得 token 并静默刷新,同时渲染已登录用户的身份徽标。应用可以按静态文件部署。

协议映射、工具调用、流式传输与结构化输出由 `@ai-sdk/openai-compatible` 提供并由上游维护。本包提供的是在 runjobs 网关上使用它所需的鉴权、成本上报与服务端工具支持。

## 安装

```bash
pnpm add @runjobsai/ai-sdk-provider @runjobsai/sdk ai
```

本包仅提供 ESM。请通过打包工具(Vite、Next、Rollup)使用,或在 Node 18 及以上版本中直接 import。

## 使用

### 浏览器,无 API key

```ts
import { createRunJobs } from "@runjobsai/ai-sdk-provider";
import { streamText } from "ai";

const runjobs = createRunJobs({ authProvider: "runjobs" });

const { textStream } = streamText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "用一句话解释异步迭代器。",
});

for await (const chunk of textStream) console.log(chunk);
```

首次调用会跳转至 runjobs.ai 授权页。此后 token 会被缓存并自动刷新。

### 服务端,使用 API key

```ts
const runjobs = createRunJobs({ apiKey: process.env.RUNJOBS_API_KEY });
```

### 同构应用

单个模块,由服务端渲染与浏览器 bundle 共同 import:

```ts
export const runjobs = createRunJobs({
  authProvider: "runjobs",
  apiKey: process.env.RUNJOBS_API_KEY, // 仅在没有 window 的环境中生效
});
```

浏览器鉴权在可用的环境中优先生效;在服务端则改用 API key。

## 客户端聊天

`useChat` 默认向应用自身的 endpoint(如 `/api/chat`)发送 POST 请求。改为传入 `DirectChatTransport` 后,整个对话循环(包括工具执行)完全运行于浏览器中:

```tsx
import { useChat } from "@ai-sdk/react";
import { DirectChatTransport, ToolLoopAgent, stepCountIs } from "ai";

const agent = new ToolLoopAgent({
  model: runjobs("Claude Sonnet 4.6"),
  tools: { weather },
  stopWhen: stepCountIs(5),
});

const { messages, sendMessage } = useChat({
  transport: new DirectChatTransport({ agent }),
});
```

无需任何服务端 endpoint。

> `useObject` 与 `useCompletion` 无法以此方式使用。二者均要求提供 `api` URL 且未开放 transport 抽象,因此都依赖服务端。如需在浏览器中实现结构化输出,请使用 `ai` core 的 `streamObject`。

## 工具循环

多步工具调用,模型访问由网关承担:

```ts
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const { text } = await generateText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "上海天气怎么样?然后建议一下穿什么。",
  tools: {
    weather: tool({
      description: "获取某个城市的天气",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, celsius: 22 }),
    }),
  },
  stopWhen: stepCountIs(5),
});
```

## 服务端工具

网关可自行执行网页搜索与内容抓取,并与模型迭代直至产出答案。该过程无需绕回应用代码,也无需自建搜索基础设施。服务端工具可与本地定义的 `tools` 混合使用,模型可调用其中任意一方。

```ts
const { text, providerMetadata } = await generateText({
  model: runjobs("Claude Sonnet 4.6"),
  prompt: "Go 最新的稳定版本是多少?",
  providerOptions: {
    runjobs: {
      serverTools: ["web_search", "web_fetch"],
      maxServerIterations: 5,
    },
  },
});
```

可用工具:`web_search`(Brave)、`web_fetch`(不计费)、`twitter_search`。

亦可配置一次并对全部调用生效:

```ts
const runjobs = createRunJobs({
  authProvider: "runjobs",
  serverTools: ["web_search"],
});
```

单次调用中的 `providerOptions.runjobs` 会覆盖 provider 级别的默认配置。

## 图像生成

```ts
import { generateImage } from "ai";

const { image } = await generateImage({
  model: runjobs.imageModel("Seedream 4.0"),
  prompt: "a gentle ocean wave",
});

image.base64; // 可直接渲染
```

在 AI SDK 中没有对应字段的网关参数,通过 `providerOptions` 传递。每个模型接受哪些
参数、各参数的合法取值都不相同,由 `/v1/models` 广播;请用 `@runjobsai/sdk` 的
`getOptionsSchema` 与 `allowedValuesFor` 读取,不要假定:

```ts
await generateImage({
  model: runjobs.imageModel("Seedream 4.0"),
  prompt: "a gentle ocean wave",
  providerOptions: {
    runjobs: { resolution: "2k", style: "anime", reference_image_urls: ["https://…"] },
  },
});
```

每张图片的附加信息通过 `providerMetadata` 返回:

```ts
const meta = result.providerMetadata.runjobs.images[0];
meta.url; // 该图片的网关 URL,无需重新编码字节即可用于展示
meta.revisedPrompt;
meta.attribution; // 图库类模型要求调用方展示的署名信息
```

`seed`、`files` 与 `mask` 不受支持,传入时会在 `result.warnings` 中返回一条警告;
带蒙版的编辑请使用 `provider.client.image.edit()`。

> 图像成本不在返回结果中,请改从 `request:end` 事件读取 `costUSD`
> (见[遥测](#遥测))。

## 语音与转写

```ts
import { experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from "ai";

const { audio } = await generateSpeech({
  model: runjobs.speechModel("CosyVoice"),
  text: "早上好。",
  voice: "nova",
});

const { text, segments } = await transcribe({
  model: runjobs.transcriptionModel("Whisper"),
  audio: bytes,
});
```

AI SDK 的字段名与网关不同:`instructions` 会作为 `instruct_text` 发送,
`outputFormat` 作为 `response_format`。网关额外提供的音色控制,例如 `emotion`、
`pitch`、`volume` 与 `timber`,在 AI SDK 中没有对应字段,通过 `providerOptions`
传递:

```ts
providerOptions: { runjobs: { emotion: "happy", pitch: 3 } }
```

`segments`、`language` 与 `durationInSeconds` 仅在模型返回详细转写结果时才有值,
该选项同样这样请求:

```ts
providerOptions: { runjobs: { response_format: "verbose_json" } }
```

某个模型接受哪些字段由 `/v1/models` 广播,请用 `@runjobsai/sdk` 的
`getOptionsSchema` 与 `allowedValuesFor` 读取。

流式转写未做映射,请使用 `provider.client.audio`。

## 成本上报

`LanguageModelV4Usage` 仅携带 token 计数,因此网关将计费信息作为 provider metadata 返回:

```ts
const { providerMetadata } = await generateText({ model: runjobs("Claude Sonnet 4.6"), prompt: "hi" });

providerMetadata?.runjobs.totalCost; // 0.0123,模型花费与全部服务端工具计费之和
providerMetadata?.runjobs.toolCosts; // [{ name: "web_search", count: 2, cost: 0.01 }]
```

流式调用的方式相同:在流读取完毕后 await `result.providerMetadata`。

## 直接访问 SDK

网关的若干能力在 AI SDK 中没有对应接口。`provider.client` 暴露底层的 `@runjobsai/sdk` 客户端,它与 provider 共享同一个 token、事件总线与身份徽标:

```ts
await runjobs.client.video.generate("MiniMax Hailuo 2.3", { prompt: "a gentle ocean wave" });
await runjobs.client.files.putString("notes.md", "# hello");
await runjobs.client.computer.step("AI Control", { messages, display_width: 1920, display_height: 1080 });

const models = await runjobs.client.models.list({ capability: "text" });
```

已有的 client 可以复用,以避免发起第二次授权流程并渲染第二个徽标:

```ts
import { RunJobs } from "@runjobsai/sdk";

const client = new RunJobs({ authProvider: "runjobs" });
const runjobs = createRunJobs({ client });
```

## 鉴权

```ts
runjobs.user; // { id, name } | null
runjobs.signIn(); // 发起授权跳转
runjobs.signOut(); // 清除已缓存的 token 与身份信息
```

## 遥测

AI SDK 的请求会触发与 SDK 自身服务相同的 `client.events`,因此身份徽标对 `streamText` 活动的反映与对 `client.chat.stream` 完全一致:

```ts
runjobs.events.on("request:end", (e) => {
  console.log(e.model, e.latencyMs, e.costUSD);
});
```

事件:`request:start`、`request:streamDelta`、`request:end`、`request:error`。

## API 参考

| 导出                         | 说明                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `createRunJobs(settings)`    | 构造 provider。接受 `@runjobsai/sdk` 的全部 `ClientOptions` 字段,以及 `client`、`serverTools`、`maxServerIterations`、`headers`、`includeUsage`。 |
| `runjobs`                    | 零配置的浏览器 provider,等价于 `createRunJobs({ authProvider: "runjobs" })`,首次使用时惰性构造。                         |
| `createAuthedFetch(options)` | 独立的鉴权与遥测 `fetch`,可用于其他 AI SDK provider。                                                                     |
| `runjobsMetadataExtractor`   | 独立的成本 metadata 提取器。                                                                                              |

| Provider 成员                                            | 类型                                    |
| ------------------------------------------------------- | --------------------------------------- |
| `runjobs(id)` / `.languageModel(id)` / `.chatModel(id)` | `LanguageModelV4`                       |
| `.embeddingModel(id)`                                   | `EmbeddingModelV4`                      |
| `.imageModel(id)`                                       | `ImageModelV4`                          |
| `.client`                                               | 底层的 `@runjobsai/sdk` 客户端          |
| `.events`                                               | 遥测总线,与 `.client.events` 为同一对象 |
| `.user` / `.signIn()` / `.signOut()`                    | 浏览器鉴权接口                          |

模型标识符即 `/v1/models` 返回的那些,例如 `"Claude Sonnet 4.6"` 或 `"Gemini 3 Flash"`。实时目录可通过 `runjobs.client.models.list()` 获取。客户端会为每个请求附加 token,因此在浏览器鉴权模式下,该调用与其他调用一样会触发登录,尽管 endpoint 本身是公开的。

## 实现状态

`ProviderV4` 定义了九个成员。四个必需成员全部已实现,五个可选成员中已实现两个:

| 成员                   | 必需 | 状态 | 说明                                    |
| ---------------------- | ---- | ---- | --------------------------------------- |
| `specificationVersion` | 是   | ✅   | `"v4"`                                  |
| `languageModel`        | 是   | ✅   | 同时以 `chatModel` 及可调用简写形式提供 |
| `embeddingModel`       | 是   | ✅   |                                         |
| `imageModel`           | 是   | ✅   |                                         |
| `speechModel`          | 否   | ✅   | 仅 `doGenerate`                         |
| `transcriptionModel`   | 否   | ✅   | 仅 `doGenerate`,流式转写未映射         |
| `rerankingModel`       | 否   | ❌   | 网关目前无对应 endpoint                 |
| `skills()`             | 否   | ❌   | 网关目前无对应 endpoint                 |
| `files()`              | 否   | ❌   | 有意不映射,见下                        |

`files()` 不会实现。它抽象的是 OpenAI 那类 provider 文件 API:上传一个 blob,
得到一个由 provider 分配的不透明引用,之后在调用模型时引用它。而 runjobs 网关的
文件服务是对象存储:路径由你决定,真正重要的操作是 `list`、`move`、`copy`、
`batch` 与 `putFromURL`,这些在 `FilesV4` 中一个对应成员都没有。用后者包装前者,
只会得到一个严格弱于该服务本身的 API。请直接使用 `provider.client.files`,并把它
返回的 `url` 传给接受 URL 的模型,例如图像模型的 `reference_image_urls`。

其余没有对应成员的能力请使用 `provider.client`,它同时覆盖 `video`、`computer`
与 `models`。

## 开发

本包是一个 pnpm workspace 的组成部分。workspace 布局、构建与测试的设计,以及
示例应用,参见[根目录 README](../../README.zh-CN.md)。

```bash
pnpm build       # src/ 至 dist/,ESM 与声明文件
pnpm typecheck
pnpm test
```

## 许可证

MIT
