# 贡献指南

[English](CONTRIBUTING.md)

感谢你为 Open Knowledge Map 做出贡献。修改代码、Schema、数据契约或公共文档前，请先阅读本指南和仓库根目录的 `AGENTS.md`。

公开贡献流程已经准备好，但尚未正式开放。项目必须先加入根目录许可文件，并确定外部贡献的权利条款。在此之前，本指南只用于维护者和受邀协作者的内部审查。

## 开始开发

本项目使用 Node.js 22 和 npm 工作区：

```bash
npm ci
```

从最新 `main` 创建含义清楚的短分支，例如 `fix/node-selection` 或 `feature/evidence-filter`。不要把互不相关的改动放进同一个分支或提交。

提交说明应简短、使用祈使句并描述实际改动，例如：

```text
Fix node click triggering full graph rebuild
```

## 架构边界

新增实现应优先使用 TypeScript，并遵守以下写入边界：

- 课时工作器只能写入 `world_lesson_runs` 和 `world_staging_*` 暂存表。
- 正式 `world_*` 表写入、重复项处理、标识重映射和最终质量状态，只能由归并器及后续规范化步骤完成。
- 共享契约放在 `packages/types`，数据库约束和知识标准放在 `schemas`。
- 教材默认按课时处理，除非改动目标明确要求采用其他粒度。
- 富化内容可以帮助命名和粒度判断，但不能成为节点或关系成立的来源证据。

如果改动会跨越这些边界，请在拉取请求中说明原因、迁移方式和回滚方案。

## 验证改动

至少运行与改动范围对应的检查：

| 改动范围 | 必须运行 |
| --- | --- |
| 任意 TypeScript 或 React 代码 | `npm run check` |
| `packages/pipeline` | `npm test -w packages/pipeline` |
| `packages/server` | `npm test -w packages/server` |
| `packages/viewer` | `npm test -w packages/viewer` |
| 构建、依赖或跨工作区改动 | `npm run build` |
| 全仓改动 | `npm run verify` |
| 流水线质量或图结构 | `npm run strict-qa -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"` 和 `npm run graph-integrity -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"` |

数据库质量检查应使用可清理的测试数据。除非明确标为集成测试，单元测试不应依赖外部数据库、真实模型接口或真实密钥。

## 数据、版权与敏感信息

不要提交：

- 未获授权的教材 PDF、页面、图片、音视频、答案或大段原文；
- 未完成公开分发审查的衍生数据集或知识对象；
- `data`、`runs`、`storage`、`tmp` 下的本地产物，除非维护者批准经过清理的小型测试夹具；
- API 密钥、数据库连接信息、令牌、个人信息、学习者记录或机构内部数据。

优先使用自行编写的最小夹具，并在拉取请求中说明来源和权利状态。详细要求见 [PROVENANCE.md](PROVENANCE.md)。

## 拉取请求

请说明：

- 改动目的和主要实现；
- 受影响的包、脚本、契约或数据表；
- 实际运行的验证命令和结果；
- 必要的兼容性、迁移和回滚说明；
- 关联的问题、运行记录或设计文档。

修改 Viewer 界面或交互时，请附改动前后截图；只有操作过程中才能看清的变化可以补充短录屏。截图和录屏不得包含密钥、个人信息或未获授权的教材内容。
