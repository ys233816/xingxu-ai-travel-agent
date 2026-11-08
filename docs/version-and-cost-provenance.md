# 模型、Prompt、工具版本与单次成本记录

每次 Agent 运行和 Live Eval 用例都会保留版本与成本来源，用于模型对比、失败复现和回滚。信息保存在运行结果的 `provenance` 中，Live Eval 还会把关键字段展开到每条用例。

## 记录内容

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| 评测集 | `versions.evaluation.version` | 固定用例集版本；当前为 `travel-eval-suite/1.1.0` |
| 评测集 | `versions.evaluation.caseIds` | 本次实际运行的用例与范围，支持 40 条全量、10 条回归和开发集比较 |
| Prompt | `prompt.version` | 人工维护的 Prompt 合同版本 |
| Prompt | `prompt.sha256` | 静态 Prompt 模板指纹；当前时间占位符不参与哈希，避免每次运行变化 |
| 模型 | `model.requested` | 请求中配置的模型名 |
| 模型 | `model.reported` | 供应商响应实际返回的模型名；未返回时明确为空 |
| 模型 | `model.responseModels[].requestId` | 请求 ID 与对应实际模型版本 |
| 工具 | `tools.version` | 工具契约版本 |
| 工具 | `tools.sha256` | 工具注册表指纹 |
| 工具 | `tools.providers` | 天气、地图、酒店供应商与 MCP 协议版本 |
| LLM 裁判 | `judge.prompt.version` | 独立裁判 Prompt 版本；当前为 `travel-judge-prompt/1.2.3`，每个维度只返回 0 或 1 |
| LLM 裁判 | `judge.providerRequestIds` | 每个维度及红线判断的真实请求 ID |
| LLM 裁判 | `sourceEvaluation.versions` | 批量机评所引用的 Agent 模型、Prompt、工具版本及 40 条用例集版本 |
| LLM 裁判 | `cases[].sourceProvenance` | 逐条保留 Agent 运行 ID、模型请求 ID、Prompt/工具指纹、来源接口和 Agent 模型成本 |
| 成本 | `modelCost.status` | `calculated`、`unavailable` 或 `zero_usage` |
| 成本 | `modelCost.amount` | 单次任务的模型 Token 成本，聚合本次全部模型轮次 |
| 成本 | `modelCost.pricing` | 输入/输出单价、币种、价格版本与来源 |

## 成本口径

单次成本只计算模型 Token 成本：

```text
缓存命中输入 Token × 命中单价
+ 缓存未命中输入 Token × 未命中单价
+ 输出 Token × 输出单价
```

价格必须由 `.env.local` 配置，系统不会使用模型记忆或猜测价格。当前 DeepSeek 配置使用用户确认的人民币单价；空闲时段暂按推荐的北京时间 `00:30–08:30`，该时间窗仍可在价格版本中继续确认或调整：

| 项目 | 空闲（CNY/百万 Token） | 高峰（CNY/百万 Token） |
| --- | ---: | ---: |
| 输入 · 缓存命中 | 0.02 | 0.04 |
| 输入 · 缓存未命中 | 1 | 2 |
| 输出 | 4 | 8 |

价格只会在供应商返回缓存命中与缓存未命中 Token 拆分后计算。缺少拆分、单价或有效时段时，结果是 `unavailable`，金额保持空值；未调用模型的阻断请求是 `zero_usage`，模型成本为 0。

天气、高德地图和 RollingGo 酒店接口的按次费用目前没有统一配置，结果中固定标记为 `externalToolCost.status = not_included`，不能把模型 Token 成本称为完整任务总成本。

```dotenv
MODEL_INPUT_PRICE_PER_MILLION=
MODEL_OUTPUT_PRICE_PER_MILLION=
MODEL_INPUT_CACHE_HIT_OFF_PEAK_PRICE_PER_MILLION=0.02
MODEL_INPUT_CACHE_HIT_PEAK_PRICE_PER_MILLION=0.04
MODEL_INPUT_CACHE_MISS_OFF_PEAK_PRICE_PER_MILLION=1
MODEL_INPUT_CACHE_MISS_PEAK_PRICE_PER_MILLION=2
MODEL_OUTPUT_OFF_PEAK_PRICE_PER_MILLION=4
MODEL_OUTPUT_PEAK_PRICE_PER_MILLION=8
MODEL_PRICE_PERIOD=auto
MODEL_OFF_PEAK_START=00:30
MODEL_OFF_PEAK_END=08:30
MODEL_PRICE_TIMEZONE=Asia/Shanghai
MODEL_PRICE_CURRENCY=CNY
MODEL_PRICE_VERSION=deepseek-2026-11-04-user-confirmed
MODEL_PRICE_SOURCE=user-confirmed
```

价格版本建议填写供应商价格表版本或生效日期；来源可填写供应商官方价格页。价格变更后应使用新的版本名，避免跨批次成本对比失去可比性。

## 对比与回滚

比较两次评测时，至少确认以下字段一致或记录差异：

- Prompt 版本与 SHA-256。
- 评测集版本与用例 ID 列表。
- 请求模型名与供应商实际返回模型名。
- 工具契约版本与 SHA-256。
- 天气、地图与酒店供应商。
- 价格版本、币种与单价。
- 模型请求 ID、Token 用量、时延和工具调用数。

回滚时需要恢复对应的 Prompt 与工具版本。模型版本应由供应商实际返回值确认，不能只依赖配置文件中的模型名称。

## 历史记录说明

此前的 `latest.json` 是在版本字段加入前产生的，无法可靠补写旧 Prompt 指纹或供应商实际模型版本；原文件保持不动。后续真实运行和评测会记录新字段，便于正式对比和回滚。

## 实际验证记录

2026-11-04 使用一条缺少日期的轻量澄清请求完成真实模型验证：供应商请求 `72596e63-3b3b-4899-909a-125c2e7b10b3` 返回的请求模型和实际模型均为 `deepseek-flash`；输入 671 Tokens 中缓存命中 384、未命中 287，输出 196 Tokens。按高峰价格计算，该次模型成本为 `0.00215736 CNY`。这是单次计量验证，不代表完整规划的平均成本。记录见 `artifacts/evaluations/provenance-smoke-test.json`。
