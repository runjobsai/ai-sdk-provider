# @runjobsai/ai-sdk-provider workspace

[English](./README.md) · **简体中文**

一个包含两部分的 pnpm workspace:对外发布的库,以及一个消费该库、可直接运行的
React 示例应用。

```text
packages/ai-sdk-provider/   库,以 @runjobsai/ai-sdk-provider 发布至 npm
index.html, src/            示例,React 19 与 Vite,private
```

库的文档位于
[`packages/ai-sdk-provider/README.zh-CN.md`](./packages/ai-sdk-provider/README.zh-CN.md),
npm 展示的是其英文版本。

## 起步

```bash
pnpm install
pnpm dev      # http://localhost:5173
```

## 脚本

在仓库根目录执行:

```bash
pnpm dev         # 示例应用,http://localhost:5173
pnpm build       # 先构建库,再构建示例应用
pnpm typecheck   # 检查两个 project
pnpm test        # 库的测试:先构建,再执行 vitest
```

仅针对库的操作可使用 filter,或在 `packages/ai-sdk-provider` 目录内执行:

```bash
pnpm --filter @runjobsai/ai-sdk-provider build
```

## 示例

每个示例是 `src/labs/` 下的单个文件,覆盖一项能力,页面会在运行中的演示旁展示其
自身源码。示例按各自的前置条件数量排序:目录示例只需网关可达,聊天示例则依赖完整链路。

| #   | 示例         | 主题                                                  |
| --- | ------------ | ----------------------------------------------------- |
| 01  | 模型目录     | `provider.client`,直接访问 SDK 的路径                 |
| 02  | generateText | 单次非流式调用,含来自 `providerMetadata` 的成本       |
| 03  | streamText   | `textStream`,以及通过 `AbortSignal` 取消              |
| 04  | useChat      | 无后端的聊天界面,详见下文                            |
| 05  | 工具循环     | `generateText({ tools })`,每一步均可展开查看          |
| 06  | 服务端工具   | `web_search` 与 `web_fetch`,由网关执行                |
| 07  | 结构化输出   | `streamObject` 在流式过程中填充 zod schema             |
| 08  | 向量嵌入     | `embedMany` 配合 `cosineSimilarity`                    |
| 09  | 图像生成      | `generateImage`,网关参数经 `providerOptions` 传入      |
| 10  | 文本转语音    | `generateSpeech`,音色取自模型目录                     |
| 11  | 语音转文本    | `transcribe`,multipart 上传与分段时间轴               |

顶部共用的连接面板为全部示例构造同一个 provider。在 `authProvider: "runjobs"` 下,
每个 provider 各自拥有一次授权握手与一份 token 缓存,因此第二个 provider 会导致
第二次登录。示例下方是 `request:*` 事件总线的实时视图,与身份徽标消费的是同一条总线。

### 客户端聊天

`useChat` 默认向应用自身的 endpoint(如 `/api/chat`)发送 POST 请求,这通常正是
纯静态客户端应用无法实现的原因。示例 04 改为传入一个包裹 `ToolLoopAgent` 的
`DirectChatTransport`,使整个循环(包括工具执行)运行于浏览器中:

```ts
const agent = new ToolLoopAgent({ model, tools: { weather }, stopWhen: stepCountIs(5) });
const { messages, sendMessage } = useChat({ transport: new DirectChatTransport({ agent }) });
```

无需任何服务端 endpoint。`useObject` 与 `useCompletion` 无法以此方式使用,二者均
要求提供 `api` URL 且未开放 transport 抽象。因此示例 07 使用 `ai` core 的
`streamObject`。

## 两部分之间的解析方式

示例通过库的发布名 `@runjobsai/ai-sdk-provider` 进行 import。该名称经由根目录
`tsconfig.json` 中的 `paths` 配置解析至 `packages/ai-sdk-provider/src/index.ts`,
即源码而非 `dist/`,而 Vite 通过 `resolve.tsconfigPaths` 原生读取该配置。因此修改
库会直接触发页面热更新,两者之间无需构建步骤,且该映射仅声明于一处。

`package.json` 中的 workspace 链接(`"@runjobsai/ai-sdk-provider": "workspace:*"`)
向 pnpm 确立了该依赖关系,并使 import 保持准确。若没有 `paths` 配置,它将解析至
构建产出的 `dist/`,而这正是已发布包的使用者所得到的内容。

## 实现说明

构建方式、测试拆分、鉴权、图像模型等无法从代码直接看出的决策,记录在
[DEVELOPMENT.md](./DEVELOPMENT.md)。

## 能力覆盖

`ProviderV4` 的九个成员中已实现六个:四个必需成员,外加 `speechModel` 与
`transcriptionModel`。`rerankingModel` 与 `skills()` 目前没有对应的网关 endpoint;
`files()` 是有意不做映射的,因为网关的文件服务是对象存储,而非 provider 文件 API。
完整表格参见
[库的 README](./packages/ai-sdk-provider/README.zh-CN.md#实现状态)。

## 发布

```bash
pnpm --filter @runjobsai/ai-sdk-provider publish
```

`prepublishOnly` 会预先执行清理、类型检查与重新构建,`files` 将打包内容限制为
`dist/` 与 README 文件。
