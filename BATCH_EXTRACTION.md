# 批量提取执行方案

## 当前进度
- ✅ 八年级全册: 15/15 (100%)
- ✅ 九年级全册: 12/12 (100%)
- ✅ 必修第一册: 13/13 (100%)
- 🔄 必修第二册: 1/10 (10%)
- ⏳ 选择性必修1: 0/12 (0%)
- ⏳ 选择性必修2: 0/9 (0%)
- ⏳ 选择性必修3: 0/12 (0%)
- **总计**: 41/81 课题已完成 (51%)

## 剩余课题清单

### 必修第二册 (9个待处理)
| # | Anchor | 课题名称 |
|---|--------|----------|
| 2 | struct:chem-senior-required-2:lesson:5-2 | 重要的金属化合物 |
| 3 | struct:chem-senior-required-2:lesson:5-3 | 化学变化中的能量变化 |
| 4 | struct:chem-senior-required-2:lesson:6-1 | 化学反应速率 |
| 5 | struct:chem-senior-required-2:lesson:6-2 | 化学平衡 |
| 6 | struct:chem-senior-required-2:lesson:6-3 | 化工生产 |
| 7 | struct:chem-senior-required-2:lesson:7-1 | 饱和烃 |
| 8 | struct:chem-senior-required-2:lesson:7-2 | 不饱和烃 |
| 9 | struct:chem-senior-required-2:lesson:7-3 | 乙醇和乙酸 |
| 10 | struct:chem-senior-required-2:lesson:7-4 | 糖、油脂和蛋白质 |

### 选择性必修1 - 化学反应原理 (12个待处理)
| # | Anchor | 课题名称 |
|---|--------|----------|
| 1 | struct:chem-senior-elective-1:lesson:1-1 | 化学反应与能量变化 |
| 2 | struct:chem-senior-elective-1:lesson:1-2 | 反应热的测量和计算 |
| 3 | struct:chem-senior-elective-1:lesson:1-3 | 燃料的合理利用 |
| 4 | struct:chem-senior-elective-1:lesson:2-1 | 化学反应的方向 |
| 5 | struct:chem-senior-elective-1:lesson:2-2 | 化学反应的限度 |
| 6 | struct:chem-senior-elective-1:lesson:2-3 | 化学反应的速率 |
| 7 | struct:chem-senior-elective-1:lesson:2-4 | 工业合成氨 |
| 8 | struct:chem-senior-elective-1:lesson:3-1 | 水的电离和溶液的酸碱性 |
| 9 | struct:chem-senior-elective-1:lesson:3-2 | 弱电解质的电离平衡 |
| 10 | struct:chem-senior-elective-1:lesson:3-3 | 酸碱中和与盐类水解 |
| 11 | struct:chem-senior-elective-1:lesson:3-4 | 难溶电解质的沉淀溶解平衡 |
| 12 | struct:chem-senior-elective-1:lesson:4-1 | 氧化还原反应 |

### 选择性必修2 - 物质结构与性质 (9个待处理)
### 选择性必修3 - 有机化学基础 (12个待处理)

## 执行建议

由于 @lesson-processor 只能处理单个课题，建议采用以下方式：

### 方式1: 创建可控的批量脚本
创建 `extract_remaining.sh` 脚本，按顺序逐个调用。

### 方式2: 使用 @kg-pipeline 进行协调
@kg-pipeline 可以协调多个 @lesson-processor 任务。

### 方式3: 人工分批处理
- 每批处理5个课题
- 每批完成后验证数据
- 有问题及时调整

## 预计时间
- 每个课题约 3-5分钟
- 42个课题 × 4分钟 = 约 168分钟 (2.8小时)

## 数据追踪

当前数据库统计：
```
nodes: 380+
edges: 599+
profiles: 330+
node_cards: 260+
```

全部完成后预计：
```
nodes: 700+ (380 + 320)
edges: 1100+ (600 + 500)
profiles: 600+
node_cards: 500+
```
