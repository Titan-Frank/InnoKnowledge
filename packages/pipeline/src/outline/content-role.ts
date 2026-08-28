import type { OutlineItem } from "../shared/pathing.js";

export type OutlineContentRole = "knowledge" | "summary" | "assessment" | "excluded";

const ASSESSMENT_PATTERN = /复习题|习题|练习|作业|测试|检测|自测|巩固题|思考题|训练题|单元测评|综合测评/;
const SUMMARY_PATTERN = /小结|归纳总结|本章总结|单元总结|知识总结|知识回顾|要点回顾|复习要点|^复习$/;
const EXCLUDED_PATTERN = /参考文献|索引|版权页|编写说明|后记/;

export function classifyOutlineContent(value: Pick<OutlineItem, "kind"> & { title?: unknown; label?: unknown }): OutlineContentRole {
  const explicit = stringValue((value as Record<string, unknown>).content_role);
  if (explicit === "knowledge" || explicit === "summary" || explicit === "assessment" || explicit === "excluded") return explicit;

  const title = `${stringValue(value.title)} ${stringValue(value.label)}`.trim();
  if (ASSESSMENT_PATTERN.test(title)) return "assessment";
  if (SUMMARY_PATTERN.test(title)) return "summary";
  if (EXCLUDED_PATTERN.test(title)) return "excluded";
  return "knowledge";
}

export function extractionPolicyForContentRole(role: OutlineContentRole): "canonical_knowledge" | "existing_nodes_only" | "excluded" {
  if (role === "assessment") return "existing_nodes_only";
  if (role === "excluded") return "excluded";
  return "canonical_knowledge";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
