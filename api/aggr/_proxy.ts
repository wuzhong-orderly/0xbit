const AGGR_ORIGIN = "https://aggr.trade";
const PROXY_PREFIX = "/api/aggr";

const BLOCKING_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

const REQUEST_HEADERS_TO_DROP = [
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "origin",
];

function getTargetUrl(requestUrl: string, host?: string) {
  const url = new URL(requestUrl, host ? `https://${host}` : undefined);
  const pathname = url.pathname.replace(PROXY_PREFIX, "") || "/";
  const targetUrl = new URL(pathname, AGGR_ORIGIN);
  targetUrl.search = url.search;
  return targetUrl;
}

function rewriteToProxy(value: string, requestUrl: string, host?: string) {
  const proxyOrigin = new URL(requestUrl, host ? `https://${host}` : undefined).origin;
  const proxyBase = `${proxyOrigin}${PROXY_PREFIX}`;

  return value
    .replaceAll(`${AGGR_ORIGIN}/`, `${proxyBase}/`)
    .replaceAll(`${AGGR_ORIGIN}`, proxyBase)
    .replaceAll("https:\\/\\/aggr.trade\\/", `${proxyBase.replaceAll("/", "\\/")}\\/`)
    .replaceAll("https:\\/\\/aggr.trade", proxyBase.replaceAll("/", "\\/"))
    .replaceAll("//aggr.trade/", `${proxyBase}/`)
    .replaceAll('href="/', `href="${PROXY_PREFIX}/`)
    .replaceAll('src="/', `src="${PROXY_PREFIX}/`)
    .replaceAll('action="/', `action="${PROXY_PREFIX}/`)
    .replaceAll('"/assets/', `"${PROXY_PREFIX}/assets/`)
    .replaceAll("'/assets/", `'${PROXY_PREFIX}/assets/`)
    .replaceAll('"/sw.js"', `"${PROXY_PREFIX}/sw.js"`)
    .replaceAll("'/sw.js'", `'${PROXY_PREFIX}/sw.js'`);
}

function getRequestHeaders(headers: Record<string, string | string[] | undefined>) {
  const requestHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (!value || REQUEST_HEADERS_TO_DROP.includes(name.toLowerCase())) {
      continue;
    }

    requestHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  return requestHeaders;
}

function getResponseHeaders(response: Response, requestUrl: string, host?: string) {
  const headers = new Headers(response.headers);

  for (const header of BLOCKING_HEADERS) {
    headers.delete(header);
  }

  const location = headers.get("location");
  if (location) {
    headers.set("location", rewriteToProxy(location, requestUrl, host));
  }

  headers.set("content-security-policy", "frame-ancestors 'self'");
  return headers;
}

function writeHeaders(res: any, headers: Headers) {
  headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
}

export default async function handler(req: any, res: any) {
  try {
    const method = (req.method || "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";
    const requestHeaders = getRequestHeaders(req.headers || {});
    const targetUrl = getTargetUrl(req.url || "/", req.headers?.host);

    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: requestHeaders,
      body: hasBody ? req : undefined,
      redirect: "manual",
      duplex: hasBody ? "half" : undefined,
    } as RequestInit & { duplex?: "half" });

    const responseHeaders = getResponseHeaders(upstreamResponse, req.url || "/", req.headers?.host);
    const contentType = responseHeaders.get("content-type") || "";

    res.statusCode = upstreamResponse.status;
    writeHeaders(res, responseHeaders);

    if (
      contentType.includes("text/") ||
      contentType.includes("javascript") ||
      contentType.includes("json") ||
      contentType.includes("xml")
    ) {
      const text = await upstreamResponse.text();
      res.end(rewriteToProxy(text, req.url || "/", req.headers?.host));
      return;
    }

    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    res.end(body);
  } catch (error) {
    console.error("Aggr proxy failed:", error);
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Aggr proxy failed");
  }
}
