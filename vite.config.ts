import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import fs from "fs";
import path from "path";

const AGGR_ORIGIN = "https://aggr.trade";
const AGGR_PROXY_PREFIX = "/api/aggr";

function loadConfigTitle(): string {
  try {
    const configPath = path.join(__dirname, "public/config.js");
    if (!fs.existsSync(configPath)) {
      return "Orderly Network";
    }

    const configText = fs.readFileSync(configPath, "utf-8");
    const jsonText = configText
      .replace(/window\.__RUNTIME_CONFIG__\s*=\s*/, "")
      .trim()
      .replace(/;$/, "");

    const config = JSON.parse(jsonText);
    return config.VITE_ORDERLY_BROKER_NAME || "Orderly Network";
  } catch (error) {
    console.warn("Failed to load title from config.js:", error);
    return "Orderly Network";
  }
}

function rewriteAggrToLocalProxy(value: string, requestOrigin: string) {
  const proxyBase = `${requestOrigin}${AGGR_PROXY_PREFIX}`;

  return value
    .replaceAll(`${AGGR_ORIGIN}/`, `${proxyBase}/`)
    .replaceAll(AGGR_ORIGIN, proxyBase)
    .replaceAll("https:\\/\\/aggr.trade\\/", `${proxyBase.replaceAll("/", "\\/")}\\/`)
    .replaceAll("https:\\/\\/aggr.trade", proxyBase.replaceAll("/", "\\/"))
    .replaceAll("//aggr.trade/", `${proxyBase}/`)
    .replaceAll('href="/', `href="${AGGR_PROXY_PREFIX}/`)
    .replaceAll('src="/', `src="${AGGR_PROXY_PREFIX}/`)
    .replaceAll('action="/', `action="${AGGR_PROXY_PREFIX}/`)
    .replaceAll('"/assets/', `"${AGGR_PROXY_PREFIX}/assets/`)
    .replaceAll("'/assets/", `'${AGGR_PROXY_PREFIX}/assets/`)
    .replaceAll('"/sw.js"', `"${AGGR_PROXY_PREFIX}/sw.js"`)
    .replaceAll("'/sw.js'", `'${AGGR_PROXY_PREFIX}/sw.js'`);
}

function aggrDevProxyPlugin(): Plugin {
  return {
    name: "aggr-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(AGGR_PROXY_PREFIX)) {
          next();
          return;
        }

        try {
          const requestOrigin = `http://${req.headers.host || "localhost"}`;
          const requestUrl = new URL(req.url, requestOrigin);
          const pathname = requestUrl.pathname.replace(AGGR_PROXY_PREFIX, "") || "/";
          const targetUrl = new URL(pathname, AGGR_ORIGIN);
          targetUrl.search = requestUrl.search;

          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (
              !value ||
              ["accept-encoding", "connection", "content-length", "host", "origin"].includes(
                name.toLowerCase(),
              )
            ) {
              continue;
            }

            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }

          const method = (req.method || "GET").toUpperCase();
          const hasBody = method !== "GET" && method !== "HEAD";
          const upstreamResponse = await fetch(targetUrl, {
            method,
            headers,
            body: hasBody ? req : undefined,
            redirect: "manual",
            duplex: hasBody ? "half" : undefined,
          } as RequestInit & { duplex?: "half" });

          const responseHeaders = new Headers(upstreamResponse.headers);
          for (const header of [
            "content-security-policy",
            "content-security-policy-report-only",
            "x-frame-options",
            "content-encoding",
            "content-length",
            "transfer-encoding",
          ]) {
            responseHeaders.delete(header);
          }

          const location = responseHeaders.get("location");
          if (location) {
            responseHeaders.set("location", rewriteAggrToLocalProxy(location, requestOrigin));
          }
          responseHeaders.set("content-security-policy", "frame-ancestors 'self'");

          res.statusCode = upstreamResponse.status;
          responseHeaders.forEach((value, name) => {
            res.setHeader(name, value);
          });

          const contentType = responseHeaders.get("content-type") || "";
          if (
            contentType.includes("text/") ||
            contentType.includes("javascript") ||
            contentType.includes("json") ||
            contentType.includes("xml")
          ) {
            const text = await upstreamResponse.text();
            res.end(rewriteAggrToLocalProxy(text, requestOrigin));
            return;
          }

          res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(`Aggr dev proxy failed: ${String(error)}`);
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("Aggr proxy failed");
        }
      });
    },
  };
}

function htmlTitlePlugin(): Plugin {
  const title = loadConfigTitle();
  console.log(`Using title from config.js: ${title}`);

  return {
    name: "html-title-transform",
    transformIndexHtml(html) {
      return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
    },
  };
}

export default defineConfig(() => {
  const basePath = process.env.PUBLIC_PATH || "/";

  return {
    base: basePath,
    plugins: [
      react(),
      tsconfigPaths(),
      htmlTitlePlugin(),
      cjsInterop({
        dependencies: ["bs58", "@coral-xyz/anchor", "lodash"],
      }),
      nodePolyfills({
        include: ["buffer", "crypto", "stream"],
      }),
      aggrDevProxyPlugin(),
    ],
    build: {
      outDir: "build/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom"],
    },
  };
});
