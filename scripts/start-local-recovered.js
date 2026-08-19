const { spawn } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const electronBinary = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const localProfile = path.join(projectRoot, ".local-recovered-profile");
const localAppUrl = process.env.VITELGLOBAL_LOCAL_APP_URL || "http://127.0.0.1:5123/";

const child = spawn(
  electronBinary,
  [projectRoot, `--user-data-dir=${localProfile}`, "--remote-debugging-port=9233"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITELGLOBAL_APP_URL: localAppUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: "inherit",
    windowsHide: false,
  },
);

child.on("error", (error) => {
  console.error(`Unable to start the recovered local Desktop runtime: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Recovered local Desktop runtime stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
