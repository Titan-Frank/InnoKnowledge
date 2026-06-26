# 高中物理沪科技版必修第三册抽取运行记录

日期：2026-06-26

## 本轮输入

- PDF：`/Users/titan-frank/Documents/hsd/research/Open-Knowledge-Map/data/高中_物理_沪科技版_高中年级_必修_第三册_物理必修_第三册.pdf`
- book_id：`physics-hukj-compulsory-3`
- dataset_id：`main`
- 模型：`/inspire/qb-ilm/project/ai4education/public/models/Qwen3.6-27B`
- 模型接口：`https://mde8h9aeeahaccccmk8gagcoao5edm8b.openapi-qb-ai.sii.edu.cn/v1`
- LLM 和 VLM：同一个模型、同一个接口；密钥只通过环境变量传入，未写入仓库文件。
- 并发：lesson 抽取并发 8，VLM 图片判断并发 8。

MinerU 已生成并缓存结果，本轮最终重跑时直接使用：

- Markdown：`data/mineru/physics-hukj-compulsory-3/full.md`
- MinerU 结果：`data/mineru/physics-hukj-compulsory-3/mineru-result.json`
- 图片目录：`data/mineru/physics-hukj-compulsory-3/images`

## 最终结果

最终数据库状态：

- `world_lesson_runs`：19 条，全部 `qa_passed`
- `world_nodes`：288
- `world_edges`：153
- `world_evidence`：436
- `world_mentions`：320
- `world_node_cards`：288
- `world_domain_profiles`：291
- `world_node_terms`：1006

关键检查结果：

- `staging_quality`：success，检查 19 个 lesson run，blocked 0
- canonical merge：completed，成功 merge run 为 `merge:73b3e9ab80f8`
- normalize：success，cycle_count 0
- strict QA：success，errors 0，warnings 0
- graph integrity：success，已执行 QA 通过标记

图完整性检查仍给出结构性提醒：

- directed cycle warnings：2
- isolated nodes：126
- disconnected components：12

这些提醒没有阻塞 QA，但说明当前图谱连边密度还不够，后续可以继续优化关系抽取和跨分块合并。

## 本轮修复

1. PDF 目录解析

   这本书目录行是中文章节和斜杠页码格式，例如 `第九章 ... / 1`、`第一节 ... / 2`。已增强 `packages/pipeline/src/outline/pdf-outline.ts`，支持中文章节、中文小节和斜杠页码。

2. 模型返回 JSON 包裹

   模型经常把 JSON 包在 Markdown 代码块里。已增强 LLM 和 VLM JSON 解析，支持纯 JSON、Markdown JSON 代码块和从正文中截取 JSON 对象。

3. 空库初始化

   清空数据库后，如果没有 `world_datasets` 的 `main` 记录，lesson 写入会失败。本轮手动补了 `main` 数据集记录。建议后续把数据集初始化做成 pipeline 的正式阶段。

4. PostgreSQL JSONB 写入

   `postgres` 驱动不能把 `JSON.stringify(...)` 后的字符串传给 `$1::jsonb`，否则 JSONB 会落成字符串。已新增 `preparePostgresJsParams`，让 `postgres` 驱动直接接收对象和数组，并把 `undefined` 转成 `null`。

5. `staging_quality` 写回质量问题

   旧数据里 `properties_json` 可能是标量 JSON，`jsonb_set` 会报 `cannot set path in scalar`。已让写回语句先判断 JSON 类型，非对象时按空对象处理。

6. 空节点名

   当前模型会返回 `id` 有值但 `name` 为空的节点。之前转换器直接丢弃，导致多个 chunk 只有 evidence 没有 nodes。现在会优先用 `title`、`label`、`term`、alias、definition 或可读 id 回填 name，并记录 issue。

7. 图片过滤后的证据引用

   VLM 过滤栏目图标后，部分节点、卡片和提及的 `source_refs` 被删空。已补充后处理：如果仍有文本证据存在，就把剩余文本证据接回节点、提及、领域画像、卡片和卡片章节。

## 中间问题

- 首轮整书 pipeline 在 `staging_quality` 阶段停止，manifest 文件 `runs/pipeline/physics-hukj-compulsory-3.okm.ts_server_pipeline.json` 仍记录为 blocked。后续是手动按阶段继续完成：重跑失败 chunk、`staging_quality`、merge、normalize、strict QA、graph integrity。
- 第一次 merge 因 `undefined` 参数失败，在 `world_merge_runs` 留下一条 `merge:5d1a551c9ef3`，已标记为 `blocked`，并在 `stats_json` 里注明已由 `merge:73b3e9ab80f8` 取代。
- `chunk:11-4-a`（电磁场与电磁波）第一次返回 0 节点，单独加明确提示重跑后成功抽出 14 个节点和 13 条边。
- `chunk:9-7-a` 曾在写 mentions 时遇到重复主键并留下半写入状态，重跑后恢复正常。这暴露出 staging 写入需要事务保护。

## 优化建议

1. 给 staging 写入加事务

   当前 lesson run upsert、旧 staging 删除、新 staging 插入不是事务式执行。任何中途失败都可能留下半写入状态。建议 `storeStagingRows` 的 PostgreSQL 执行器支持事务包裹。

2. 增加失败 chunk 自动重试

   如果某个 chunk 出现 `nodes=0`、`mentions=0`、`staging_quality` blocked 或模型返回空 name 过多，可以自动用更强提示重跑该 chunk，而不是停掉整本书。

3. 让 manifest 支持续跑结果

   当前 server pipeline manifest 只记录第一次停止点，手动续跑后的成功结果不会回写。建议增加 resume manifest 或 downstream summary，避免最终数据库已成功但 manifest 仍显示 blocked。

4. 数据集初始化内置化

   空库重跑时应自动 upsert `world_datasets(dataset_id='main')`，避免外部手动 SQL。

5. 节点展示名质量门

   本轮仍有少数 canonical name 来自 id 回填，例如 `n_primary_energy`、`n_nuclear_energy`。建议增加中文展示名检查：如果 name 像机器 id，应进入重试或后处理改名，而不是直接进入 canonical。

6. 关系抽取需要增强

   graph integrity 显示孤立节点 126、弱连通分量 12。建议在提示词中要求每个核心节点至少产出 1 条关系；同时在 reducer 前增加关系补全阶段，基于同一 lesson 的 node card 和 evidence 自动补 `related_to`、`part_of`、`uses` 等低风险关系。

7. VLM 图片判断可加规则前置

   VLM 已能过滤大量问号图标和栏目图，但小图标、封底、二维码、出版社标志等可以先用尺寸、文件位置、caption 规则快速过滤，减少 VLM 调用成本。

8. 模型输出 schema 可以更硬

   当前 schema 虽然要求字段存在，但模型仍会填空字符串。建议在转换前增加更明确的 prompt 约束，或在响应后统计空字段比例，超过阈值自动重试。

## 已验证命令

```bash
npm test -w packages/pipeline
npm run check
npm run build
```

上述命令均已通过。`npm run build` 中 viewer 构建成功，但 Vite 提示主 JS chunk 超过 500 kB，这是前端打包体积提醒，不影响本轮抽取结果。
