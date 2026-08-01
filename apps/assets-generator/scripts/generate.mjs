import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import templateDimensions from "../src/template-dimensions.json" with { type: "json" };

const applicationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();

function readOptions(arguments_) {
  let template = "og";
  let output;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--") {
      continue;
    } else if (argument === "--template" && value) {
      template = value;
      index += 1;
    } else if (argument === "--output" && value) {
      output = value;
      index += 1;
    } else if (argument === "--help") {
      return { kind: "help" };
    } else {
      return { kind: "error", message: `Unknown or incomplete option: ${argument}` };
    }
  }

  return { kind: "options", template, output };
}

function findChrome() {
  const candidates = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
    win32: [
      `${process.env.PROGRAMFILES ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
  };

  return (candidates[process.platform] ?? []).find((candidate) => existsSync(candidate));
}

const options = readOptions(process.argv.slice(2));
if (options.kind === "help") {
  console.log("Usage: pnpm generate -- --template <id> --output <file.png>");
  process.exit(0);
}
if (options.kind === "error") {
  console.error(options.message);
  process.exit(1);
}

const dimensions = templateDimensions[options.template];
if (!dimensions) {
  console.error(`Unknown template: ${options.template}`);
  console.error(`Available templates: ${Object.keys(templateDimensions).join(", ")}`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.error("Chrome or Chromium not found.");
  process.exit(1);
}

await build({ root: applicationDirectory, logLevel: "error" });

const output = options.output
  ? resolve(invocationDirectory, options.output)
  : resolve(applicationDirectory, "generated", `${options.template}.png`);
mkdirSync(dirname(output), { recursive: true });
const pageUrl = new URL(pathToFileURL(resolve(applicationDirectory, "dist/index.html")));
pageUrl.searchParams.set("render", options.template);

const result = spawnSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1000",
    "--force-device-scale-factor=1",
    `--window-size=${dimensions.width},${dimensions.height}`,
    `--screenshot=${output}`,
    pageUrl.href,
  ],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  console.error(result.stderr || "Chrome failed to render the asset.");
  process.exit(result.status ?? 1);
}

console.log(`${options.template} -> ${output}`);
