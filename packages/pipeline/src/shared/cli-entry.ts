import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(
  importMetaUrl: string,
  argv1: string | undefined = process.argv[1],
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!argv1) return false;
  try {
    const modulePath = resolve(fileURLToPath(importMetaUrl));
    const entryPath = resolve(argv1);
    return platform === "win32"
      ? modulePath.toLowerCase() === entryPath.toLowerCase()
      : modulePath === entryPath;
  } catch {
    return false;
  }
}
