import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const files = ["src/api/types.ts", "src/api/fixtures.ts", "src/api/client.ts"];

for (const file of files) {
  const absolutePath = path.resolve(file);
  const fileUrl = pathToFileURL(absolutePath).href;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--eval", `import(${JSON.stringify(fileUrl)});`],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`lint: validated ${files.length} frontend source files`);
