import { componentize, version } from "@bytecodealliance/componentize-js";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const start = performance.now();

const { component, imports } = await componentize({
  sourcePath: new URL("./with-import.js", import.meta.url).pathname,
  witPath: new URL("./with-import.wit", import.meta.url).pathname,
  worldName: "capsule",
  disableFeatures: ["stdio", "random", "clocks", "http", "fetch-event"],
});

const elapsed = ((performance.now() - start) / 1000).toFixed(2);

await mkdir("dist", { recursive: true });
await writeFile("dist/with-import.wasm", component);
const info = await stat("dist/with-import.wasm");

console.log(JSON.stringify({
  componentizeJsVersion: version,
  outputBytes: info.size,
  outputMb: (info.size / 1024 / 1024).toFixed(2),
  componentizeTimeSec: elapsed,
  declaredImports: imports,
}, null, 2));
