import { createHmac, randomBytes } from "crypto";

type FetchLike = typeof fetch;

export interface SignedSheetRequest {
  timestamp: string;
  nonce: string;
  data: string;
  signature: string;
}

export function validateSheetEndpoint(endpointUrl: string) {
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    throw new Error("URL Apps Script tidak valid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
  )
    throw new Error("Gunakan URL deployment Apps Script yang berakhiran /exec");
  return url.toString();
}

export function createSignedSheetRequest(payload: unknown, secret: string) {
  if (secret.trim().length < 32)
    throw new Error("Secret Google Sheet minimal 32 karakter");
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret.trim())
    .update(`${timestamp}.${nonce}.${data}`)
    .digest("hex");
  return { timestamp, nonce, data, signature } satisfies SignedSheetRequest;
}

export async function sendSheetRequest(
  endpointUrl: string,
  secret: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch,
) {
  const url = validateSheetEndpoint(endpointUrl);
  const body = createSignedSheetRequest(payload, secret);
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Respons Apps Script tidak valid");
  }
  if (!response.ok || !result?.ok)
    throw new Error(result?.error || `Ekspor gagal (${response.status})`);
  return result;
}
