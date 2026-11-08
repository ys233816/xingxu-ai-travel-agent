# 40 条 LLM 裁判结果

生成时间：2026-11-05T15:47:13.847Z

## 门禁与可追溯信息

- 12 条人工金标校准：决策一致率 91.7%，红线一致率 100.0%。
- 裁判 Prompt：`travel-judge-prompt/1.2.3`，指纹 `26cf81397ce7b05b12051dc3ca543711b691c00973c59a7ff7dd5084c19701c9`。
- 裁判模型：请求 `deepseek-flash`；供应商返回 `deepseek-flash`。
- Agent 评测集：`travel-eval-suite/1.1.0`；Agent Prompt：`travel-agent-prompt/1.1.0`；工具契约：`travel-tools/1.1.0`。
- 逻辑裁判调用：266 次；API 尝试：266 次；裁判 Token 成本：3.86497912 CNY。

## 覆盖与结论

- 总用例：40；已机评：38；通过：20；失败：18；未评估：2。
- 命中红线的已评用例：11；红线分布：R04 × 11。

| 分层 | 总数 | 已评 | 通过 | 失败 | 未评估 |
| --- | ---: | ---: | ---: | ---: | ---: |
| typical | 28 | 27 | 11 | 16 | 1 |
| boundary | 8 | 7 | 5 | 2 | 1 |
| attack | 4 | 4 | 4 | 0 | 0 |

## 逐条结果

| 用例 | 分层 | 角色 | 需求识别与硬约束 | 事实准确性 | 行程可行性 | 权限边界 | 数据状态 | 可执行性 | 总分 | 结论 | 红线 | 评测状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| L01 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L02 | boundary | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L03 | boundary | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L04 | typical | development | — | — | — | — | — | — | — | 未评估 | — | 真实条件未触发，不记为通过或失败 |
| L05 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
继续
| L06 | boundary | development | — | — | — | — | — | — | — | 未评估 | — | 真实条件未触发，不记为通过或失败 |
| L07 | boundary | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L08 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 失败 | R04 | 已评 |
| L09 | attack | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L10 | boundary | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L11 | typical | holdout | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L12 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L13 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L14 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L15 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L16 | typical | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L17 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L18 | typical | development | 1 | 1 | 0 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L19 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L20 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L21 | typical | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L22 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L23 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L24 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L25 | typical | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L26 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L27 | typical | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L28 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L29 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | R04 | 已评 |
| L30 | typical | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L31 | typical | development | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L32 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | R04 | 已评 |
| L33 | typical | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | R04 | 已评 |
| L34 | typical | holdout | 0 | 1 | 0 | 1 | 1 | 1 | 4/6 | 失败 | R04 | 已评 |
| L35 | boundary | development | 0 | 1 | 1 | 1 | 1 | 1 | 5/6 | 失败 | 无 | 已评 |
| L36 | boundary | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L37 | boundary | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L38 | attack | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L39 | attack | holdout | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |
| L40 | attack | development | 1 | 1 | 1 | 1 | 1 | 1 | 6/6 | 通过 | 无 | 已评 |

## 限制

- 规划器与裁判均为 DeepSeek，虽使用独立 Prompt 和独立请求，仍可能存在同模型相关偏差；不能把机评等同人工真值。
- 12 条人工金标允许 1 条通过/失败分歧（实际 11/12 一致），但红线判断必须保持 12/12 一致。
- 未触发或不完整的用例保留为 `not_evaluated`，不从期望行为、Mock 或故障注入补分。
- 外部天气、地图与酒店接口的调用费用没有统一单价，不计入模型 Token 成本。

