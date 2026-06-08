export const config = {
  runtime: "edge",
};

const AGGR_ORIGIN = "https://aggr.trade";
const PROXY_PREFIX = "/api/aggr";

const BLOCKING_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
];

function getTargetUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  const pathname = url.pathname.replace(PROXY_PREFIX, "") || "/";
  const targetUrl = new URL(pathname, AGGR_ORIGIN);
  targetUrl.search = url.search;
  return targetUrl;
}

function rewriteToProxy(value: string, requestUrl: string) {
  const proxyOrigin = new URL(requestUrl).origin;
  const proxyBase = `${proxyOrigin}${PROXY_PREFIX}`;

  return value
    .replaceAll(`${AGGR_ORIGIN}/`, `${proxyBase}/`)
    .replaceAll(`${AGGR_ORIGIN}`, proxyBase)
    .replaceAll("//aggr.trade/", `${proxyBase}/`)
    .replaceAll('href="/', `href="${PROXY_PREFIX}/`)
    .replaceAll('src="/', `src="${PROXY_PREFIX}/`)
    .replaceAll('action="/', `action="${PROXY_PREFIX}/`);
}

function getResponseHeaders(response: Response, requestUrl: string) {
  const headers = new Headers(response.headers);

  for (const header of BLOCKING_HEADERS) {
    headers.delete(header);
  }

  const location = headers.get("location");
  if (location) {
    headers.set("location", rewriteToProxy(location, requestUrl));
  }

  headers.set("content-security-policy", "frame-ancestors 'self'");
  return headers;
}

export default async function handler(request: Request) {
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("host", new URL(AGGR_ORIGIN).host);
  requestHeaders.delete("origin");

  const upstreamResponse = await fetch(getTargetUrl(request.url), {
    method,
    headers: requestHeaders,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  const responseHeaders = getResponseHeaders(upstreamResponse, request.url);
  const contentType = responseHeaders.get("content-type") || "";

  if (contentType.includes("text/html")) {
    const html = await upstreamResponse.text();
    return new Response(rewriteToProxy(html, request.url), {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
