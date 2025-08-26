import OpenAI from "openai"

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable")
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Truncate text if it's too long (OpenAI has limits)
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: truncatedText,
      encoding_format: "float",
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);

    // Check for specific error types
    if (error instanceof Error) {
      if (
        error.message.includes("rate_limit") ||
        error.message.includes("429")
      ) {
        throw new Error("Rate limit exceeded - please try again later");
      }
      if (
        error.message.includes("quota") ||
        error.message.includes("billing")
      ) {
        throw new Error(
          "API quota exceeded - please check your OpenAI billing"
        );
      }
      if (
        error.message.includes("fetch failed") ||
        error.message.includes("network")
      ) {
        throw new Error("Network error - please check your connection");
      }
    }

    throw new Error("Failed to generate embedding");
  }
}

export async function generateEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  // Split into chunks of 64 inputs to stay well under limits and reduce rate-limit pressure
  const batchSize = 64;
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts
      .slice(i, i + batchSize)
      .map((t) => (t.length > 8000 ? t.substring(0, 8000) : t));
    // Retry with backoff for resilience
    let lastErr: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: slice,
          encoding_format: "float",
        });
        for (const row of response.data) embeddings.push(row.embedding);
        lastErr = undefined;
        break;
      } catch (error) {
        lastErr = error;
        const jitter = Math.floor(Math.random() * 250);
        const delay = 1000 * Math.pow(2, attempt) + jitter;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (lastErr) {
      throw lastErr;
    }
    // Small pacing delay between batches
    await new Promise((r) => setTimeout(r, 200));
  }
  return embeddings;
}

export async function generateChatResponse(
  messages: Array<{ role: string; content: string }>,
  context: string
) {
  try {
    const systemPrompt = `You are a helpful AI assistant that can search through the user's chat history to answer questions. 

Use the following context from their chat history to answer their question:

${context}

Instructions:
- Answer based on the provided context when relevant
- If the context doesn't contain relevant information, say so politely
- Be conversational and helpful
- Reference specific details from the chat history when appropriate
- If asked about specific people, dates, or events, look for that information in the context`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    return (
      response.choices[0]?.message?.content ||
      "I apologize, but I couldn't generate a response."
    );
  } catch (error) {
    console.error("Error generating chat response:", error);
    throw new Error("Failed to generate response");
  }
}
