# Source manifest for the public inspection snapshot

This file records the source information that can be established from the exported `knowledge/main` data, the local source PDF, and the repository as of 2026-07-13. It is intentionally explicit about the rights conflict: public accessibility or an operator statement that a textbook is open source is not a substitute for an upstream license or written permission.

| Field | Recorded value |
| --- | --- |
| Dataset | `main` |
| Source identifier found in exported units | `physics-hukj-compulsory-3` |
| Title on the PDF | 普通高中教科书《物理 必修 第三册》 |
| Subject and stage | 物理，高中 |
| Organizing body | 上海市中小学（幼儿园）课程改革委员会 |
| Publisher | 上海科学技术出版社 |
| ISBN | `978-7-5478-5220-0/G·1025` |
| Edition and printing | 2021 年 1 月第 1 版；2024 年 8 月第 4 次印刷 |
| Exact upstream material URL | Not recorded |
| Local acquisition record | 2026-06-26; file metadata points to an institutional file service, not a verified publisher or license page |
| License name and identifier | No open license found |
| Rights statement in the PDF | The copyright page reserves rights and requires permission for copying or use |
| Repository-owner statement | The repository owner previously described the textbook as open source |
| Verification status | Conflict unresolved; public redistribution is not cleared without an applicable license or explicit permission |

The bibliographic fields above come from the local PDF title and copyright pages. The current PostgreSQL snapshot still contains no `world_source_artifacts` row for this source, so the exporter cannot prove source clearance mechanically. More importantly, the PDF's own rights statement conflicts with the earlier open-source description; the restrictive statement controls unless the rights holder supplies an applicable open license or explicit permission.

The public artifact omits binary textbook images and live source-asset paths. It still contains textbook-derived textual evidence and generated records, so public inspection must not be interpreted as a separate reuse license. See [RIGHTS.md](RIGHTS.md) for the publication boundary.

## 中文说明

当前公开查看快照中的知识单元统一使用来源编号 `physics-hukj-compulsory-3`。本地 PDF 版权页可确认书名为普通高中教科书《物理 必修 第三册》，由上海科学技术出版社出版，ISBN 为 `978-7-5478-5220-0/G·1025`，2021 年 1 月第 1 版、2024 年 8 月第 4 次印刷。项目维护者此前说明该教材属于开源教材，但 PDF 本身保留版权并要求复制或使用前获得许可，且当前没有开放许可证或书面授权可以消除这一冲突。因此该成果尚未完成公开再分发授权。
