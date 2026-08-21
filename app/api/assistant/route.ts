import { env } from "cloudflare:workers";

type AssistantRequest = {
  question?: string;
  context?: unknown;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as AssistantRequest;
    const question = body.question?.trim();
    if (!question) return Response.json({ error: "A question is required." }, { status: 400 });
    const runtime = env as unknown as { LOCAL_LLM_URL?: string; LOCAL_LLM_MODEL?: string };
    const localLlmUrl = (runtime.LOCAL_LLM_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const model = runtime.LOCAL_LLM_MODEL || "qwen2.5:1.5b";
    const context = JSON.stringify(body.context ?? {}).slice(0, 20_000);
    const history = (body.history ?? []).slice(-8).map((message) => `${message.role.toUpperCase()}: ${message.text}`).join("\n");
    const apiResponse = await fetch(`${localLlmUrl}/api/chat`, {
      method: "POST",
      signal: request.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "30m",
        options: { temperature: 0.05, num_ctx: 4096, num_predict: 180 },
        messages: [
          { role: "system", content: "You are LinePilot, an MES production-planning assistant for Ideal Gas Springs. Answer only from the supplied active-application data. The currentSystemDate field is the authoritative current date; never infer today's date from planning dates, due dates, or conversation history. Understand conversational questions, spelling errors, dates, product codes, batches, Tube Shop, powder coating, assembly lines, capacity, OEE, bottlenecks, actuals, backlog and schedules. Give readable line-by-line answers with a short heading and bullets. Show calculations when useful. If data is absent, say exactly what is missing. Never invent values. Do not claim that an application change was made; plan mutations are handled separately by the UI confirmation workflow." },
          { role: "user", content: `ACTIVE APPLICATION DATA\n${context}\n\nRECENT CONVERSATION\n${history || "None"}\n\nUSER QUESTION\n${question}` },
        ],
      }),
    });
    const payload = await apiResponse.json() as { error?: string; message?: { content?: string } };
    if (!apiResponse.ok) return Response.json({ error: payload.error || "The local LLM request failed." }, { status: apiResponse.status });
    const answer = payload.message?.content?.trim();
    if (!answer) return Response.json({ error: "The LLM returned an empty answer." }, { status: 502 });
    return Response.json({ answer, model, local: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to answer the question." }, { status: 500 });
  }
}
