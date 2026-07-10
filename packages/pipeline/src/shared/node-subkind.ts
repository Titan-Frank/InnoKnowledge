type RawRecord = Record<string, unknown>;

export type NormalizedNodeSubkind = {
  primary: string | null;
  subkinds: string[];
  rawSubkinds: string[];
};

const SUBKIND_ALIASES = new Map<string, string>([
  ["物理定律", "physical_law"],
  ["物理规律", "physical_law"],
  ["核心规律总结", "physical_law"],
  ["物理公式", "physical_formula"],
  ["电路计算公式", "circuit_formula"],
  ["电路连接方式", "circuit_configuration"],
  ["物理量", "physical_quantity"],
  ["基本电学物理量", "physical_quantity"],
  ["矢量物理量", "vector_quantity"],
  ["标量", "scalar_quantity"],
  ["标量/状态量", "scalar_state_quantity"],
  ["物理参数", "physical_parameter"],
  ["电势差", "electric_potential_difference"],
  ["阻碍作用", "resistance_effect"],
  ["测量仪器", "measurement_instrument"],
  ["检测工具", "measurement_instrument"],
  ["实验器材", "experimental_device"],
  ["实验操作步骤", "experimental_method"],
  ["实验观测方法", "experimental_method"],
  ["演示实验", "demonstration_experiment"],
  ["经典物理实验", "physics_experiment"],
  ["电学测量方法", "electrical_measurement_method"],
  ["分析计算方法", "analysis_method"],
  ["物理现象", "physical_phenomenon"],
  ["自然现象", "natural_phenomenon"],
  ["电学现象", "electrical_phenomenon"],
  ["电路异常状态", "circuit_fault_state"],
  ["电路特殊状态", "circuit_state"],
  ["电路拓扑结构", "circuit_configuration"],
  ["电路模型", "circuit_model"],
  ["理想化模型", "idealized_model"],
  ["物理模型", "physical_model"],
  ["物理图像模型", "physical_model"],
  ["实验数据图像", "experimental_graph"],
  ["图形标识规范", "graphical_notation"],
  ["几何模型", "geometric_model"],
  ["物理过程", "physical_process"],
  ["微观物理过程", "microscopic_physical_process"],
  ["安全机制", "safety_mechanism"],
  ["安全措施", "safety_measure"],
  ["方向判断法则", "direction_rule"],
  ["功能关系", "functional_relation"],
  ["场性质", "field_property_rule"],
]);

const GENERIC_SUBKINDS = new Set(["definition", "classification", "property", "principle", "theory"]);

export function normalizeNodeSubkind(_kind: string | null | undefined, value: unknown): NormalizedNodeSubkind {
  const raw = stringValue(value).trim();
  if (!raw) return { primary: null, subkinds: [], rawSubkinds: [] };

  const mapped = SUBKIND_ALIASES.get(raw) ?? normalizeAsciiSubkind(raw);
  const primary = mapped && isAllowedSubkindCode(mapped) ? mapped : null;
  return {
    primary,
    subkinds: primary ? [primary] : [],
    rawSubkinds: primary === raw ? [] : [raw],
  };
}

export function addNodeSubkindClassification(properties: RawRecord, normalized: NormalizedNodeSubkind): RawRecord {
  const subkinds = mergeUniqueStrings(classificationStrings(properties, "subkinds"), normalized.subkinds);
  const rawSubkinds = mergeUniqueStrings(classificationStrings(properties, "raw_subkinds"), normalized.rawSubkinds);
  if (subkinds.length === 0 && rawSubkinds.length === 0) return { ...properties };

  return {
    ...properties,
    classifications: {
      ...recordValue(properties.classifications),
      ...(subkinds.length > 0 ? { subkinds } : {}),
      ...(rawSubkinds.length > 0 ? { raw_subkinds: rawSubkinds } : {}),
    },
  };
}

export function mergeNodeSubkindClassifications(input: {
  properties: RawRecord;
  subkinds: Array<unknown>;
  rawSubkinds?: Array<unknown>;
}): RawRecord {
  const normalizedSubkinds = mergeUniqueStrings(
    classificationStrings(input.properties, "subkinds"),
    input.subkinds.map((value) => normalizeNodeSubkind(null, value).primary).filter((value): value is string => Boolean(value)),
  );
  const rawSubkinds = mergeUniqueStrings(classificationStrings(input.properties, "raw_subkinds"), input.rawSubkinds ?? []);
  if (normalizedSubkinds.length === 0 && rawSubkinds.length === 0) return { ...input.properties };

  return {
    ...input.properties,
    classifications: {
      ...recordValue(input.properties.classifications),
      ...(normalizedSubkinds.length > 0 ? { subkinds: normalizedSubkinds } : {}),
      ...(rawSubkinds.length > 0 ? { raw_subkinds: rawSubkinds } : {}),
    },
  };
}

export function choosePrimarySubkind(existing: unknown, staged: unknown): string | null {
  const existingCode = normalizeNodeSubkind(null, existing).primary;
  const stagedCode = normalizeNodeSubkind(null, staged).primary;
  if (existingCode && !isGenericSubkind(existingCode)) return existingCode;
  if (stagedCode && !isGenericSubkind(stagedCode)) return stagedCode;
  return existingCode ?? stagedCode;
}

export function isGenericSubkind(value: string | null | undefined): boolean {
  return Boolean(value && GENERIC_SUBKINDS.has(value));
}

function normalizeAsciiSubkind(value: string): string | null {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (token) return token;
  return null;
}

function isAllowedSubkindCode(value: string): boolean {
  return /^[a-z0-9][a-z0-9_]*$/.test(value);
}

function classificationStrings(properties: RawRecord, key: "subkinds" | "raw_subkinds"): string[] {
  const classifications = recordValue(properties.classifications);
  return Array.isArray(classifications[key]) ? mergeUniqueStrings(classifications[key]) : [];
}

function recordValue(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function mergeUniqueStrings(...groups: Array<Iterable<unknown>>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      if (typeof value !== "string") continue;
      const token = value.trim();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}
