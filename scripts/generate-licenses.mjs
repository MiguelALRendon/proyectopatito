import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = "x86_64-pc-windows-msvc";
const unknown = "sin declarar";

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && ["npm", "npx"].includes(command),
  });
}

function crateRows() {
  const text = run(
    "cargo",
    [
      "tree",
      "-e",
      "normal",
      "--prefix",
      "none",
      "--target",
      target,
      "--format",
      "{p}|{l}",
    ],
    join(root, "src-tauri"),
  );
  const rows = new Map();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const [label, license] = line.split("|");
    const name = label.replace(/ \(.*\)$/, "").trim();
    if (name.startsWith("dakedaduck-svn")) continue;
    rows.set(name, license?.trim() || unknown);
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}

function packageRows() {
  const text = run("npm", ["ls", "--omit=dev", "--all", "--parseable"], root);
  const rows = new Map();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const path = line.trim();
    if (path === root) continue;
    try {
      const manifest = JSON.parse(
        readFileSync(join(path, "package.json"), "utf8"),
      );
      const license =
        manifest.license ?? manifest.licenses?.[0]?.type ?? unknown;
      rows.set(`${manifest.name} ${manifest.version}`, String(license));
    } catch {
      continue;
    }
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}

function table(title, note, rows) {
  const body = rows
    .map(([name, license]) => `| ${name} | ${license} |`)
    .join("\n");
  return `## ${title}\n\n${note}\n\n| Paquete | Licencia |\n|---|---|\n${body}\n`;
}

const header = readFileSync(
  join(root, "third_party", "licenses-header.md"),
  "utf8",
);
const packages = packageRows();
const crates = crateRows();
const document = [
  header.trimEnd(),
  table(
    "Paquetes de npm que llegan a la interfaz",
    `Salen de \`package-lock.json\` (solo dependencias de ejecución, ${packages.length} paquetes).`,
    packages,
  ),
  table(
    "Crates de Rust enlazados en el ejecutable",
    `Salen de \`Cargo.lock\` para ${target} (solo dependencias normales, ${crates.length} crates).`,
    crates,
  ),
].join("\n");
writeFileSync(join(root, "THIRD_PARTY_LICENSES.md"), `${document}\n`);
run("npx", ["prettier", "--write", "THIRD_PARTY_LICENSES.md"], root);
console.log(
  `THIRD_PARTY_LICENSES.md: ${packages.length} paquetes, ${crates.length} crates`,
);
