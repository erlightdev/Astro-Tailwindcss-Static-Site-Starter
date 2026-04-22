// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const srcAssetsDir = fileURLToPath(new URL("./src/assets", import.meta.url));
const publicBuildPath = ["assets", "public"];
const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function rewriteAssetReferences(rootDir, replacers) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(html|js|css)$/i.test(entry.name)) continue;

      let contents = await fs.promises.readFile(fullPath, "utf8");
      let changed = false;
      for (const [from, to] of replacers) {
        if (contents.includes(from)) {
          contents = contents.split(from).join(to);
          changed = true;
        }
      }
      if (changed) {
        await fs.promises.writeFile(fullPath, contents, "utf8");
      }
    }
  }
}

async function fixVendorReferences(outDir) {
  const vendorMappings = [
    { folder: "swiper", baseName: "swiper", legacyPrefix: "vendor-swiper" },
    { folder: "gsap", baseName: "gsap", legacyPrefix: "vendor-gsap" },
  ];

  const replacers = [];
  for (const mapping of vendorMappings) {
    const scopedDir = path.join(outDir, "assets", "vendor", mapping.folder);
    let files = [];
    try {
      files = await fs.promises.readdir(scopedDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.isFile()) continue;
      const fileName = file.name;
      const legacyName = fileName.replace(
        new RegExp(`^${mapping.baseName}\\.`),
        `${mapping.legacyPrefix}.`,
      );
      if (legacyName === fileName) continue;

      replacers.push([`./assets/${legacyName}`, `./assets/vendor/${mapping.folder}/${fileName}`]);
      replacers.push([`/assets/${legacyName}`, `/assets/vendor/${mapping.folder}/${fileName}`]);
      replacers.push([`"./${legacyName}"`, `"./vendor/${mapping.folder}/${fileName}"`]);
      replacers.push([`'./${legacyName}'`, `'./vendor/${mapping.folder}/${fileName}'`]);
    }
  }

  if (replacers.length > 0) {
    await rewriteAssetReferences(outDir, replacers);
  }
}

function assetsPostBuildIntegration() {
  return {
    name: "assets-post-build",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);

        try {
          await fs.promises.access(srcAssetsDir);
          const targetDir = path.join(outDir, ...publicBuildPath);
          await fs.promises.rm(targetDir, { recursive: true, force: true });
          await copyDir(srcAssetsDir, targetDir);
        } catch {
          // no src/assets to copy
        }

        await fixVendorReferences(outDir);
      },
    },
  };
}

function assetsPublicPlugin() {
  return {
    name: "astro-assets-public",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/assets/public/")) return next();
        const requestPath = decodeURIComponent(req.url.slice("/assets/public/".length));
        const filePath = path.join(srcAssetsDir, requestPath);

        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) return next();

          const ext = path.extname(filePath).toLowerCase();
          const mime = mimeTypes[ext] || "application/octet-stream";

          res.statusCode = 200;
          res.setHeader("content-type", mime);
          fs.createReadStream(filePath).pipe(res);
        } catch {
          return next();
        }
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  integrations: [assetsPostBuildIntegration()],
  output: "static",
  trailingSlash: "never",
  build: {
    format: "file",
    assets: "assets",
    assetsPrefix: "./",
  },
  vite: {
    plugins: [tailwindcss(), assetsPublicPlugin()],
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            const assetName = assetInfo.names?.[0] || assetInfo.name || "";
            if (assetName.includes("vendor/swiper/") || assetName.includes("vendor/gsap/")) {
              return "assets/[name]-[hash][extname]";
            }
            if (assetName.endsWith(".css")) {
              return "assets/css/[name]-[hash][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
          chunkFileNames: (chunkInfo) => {
            if (chunkInfo.name?.startsWith("vendor/")) {
              return "assets/[name]-[hash].js";
            }
            return "assets/js/[name]-[hash].js";
          },
          entryFileNames: "assets/js/[name]-[hash].js",
          manualChunks: (id) => {
            if (id.includes("node_modules/swiper")) return "vendor/swiper/swiper";
            if (id.includes("node_modules/gsap")) return "vendor/gsap/gsap";
          },
        },
      },
    },
  },
});
