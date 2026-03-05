type IntentClassifierConfig = {
  url: string
  audience: string
  threshold: number
}

type ClassifyIntentResponse = {
  should_respond: boolean
  reasoning?: string
}

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"

function getIntentClassifierConfig(): IntentClassifierConfig | null {
  const url = process.env.INTENT_CLASSIFIER_URL?.trim()
  if (!url) return null

  const thresholdRaw = process.env.INTENT_CLASSIFIER_THRESHOLD
  const threshold = thresholdRaw ? Number.parseFloat(thresholdRaw) : 0.75
  const audience = process.env.INTENT_CLASSIFIER_AUDIENCE?.trim() || url

  return {
    url,
    audience,
    threshold: Number.isFinite(threshold) ? threshold : 0.75,
  }
}

async function getIdentityToken(audience: string): Promise<string | null> {
  const requestUrl = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`
  try {
    const res = await fetch(requestUrl, {
      headers: { "Metadata-Flavor": "Google" },
    })
    if (!res.ok) {
      console.warn("[intent-classifier] metadata token fetch failed", res.status)
      return null
    }
    return await res.text()
  } catch (error) {
    console.warn("[intent-classifier] metadata token fetch error", error)
    return null
  }
}

export async function classifyIntent(chatHistory: { role: string; text: string }[]) {
  const config = getIntentClassifierConfig()
  if (!config) return null

  const token = await getIdentityToken(config.audience)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${config.url.replace(/\/$/, "")}/v1/classify-intent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ chat_history: chatHistory }),
  })

  const requestId = response.headers.get("x-request-id") ?? undefined

  if (!response.ok) {
    console.warn("[intent-classifier] request failed", response.status, requestId)
    return null
  }

  const data = (await response.json()) as ClassifyIntentResponse
  const confidence = data.should_respond ? 1 : 0
  const shouldInvoke = data.should_respond && confidence >= config.threshold

  return {
    shouldInvoke,
    reasoning: data.reasoning ?? "",
    threshold: config.threshold,
    requestId,
  }
}
