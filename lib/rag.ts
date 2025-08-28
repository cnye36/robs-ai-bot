import { createClient } from "@/lib/supabase/server"
import { generateEmbedding, generateEmbeddingsBatch } from "@/lib/openai";
import { formatChatDate } from "@/lib/utils";

export interface ChatHistoryMatch {
  id: string;
  participant_name: string;
  creator_name: string | null;
  creator_email: string | null;
  creator_user_type: string | null;
  message_content: string;
  message_date: string | null;
  topic_id: string | null;
  message_id: string | null;
  original_filename: string;
  similarity: number;
}

export async function searchChatHistory(
  query: string,
  userId: string,
  matchThreshold = 0.78,
  matchCount = 10
): Promise<ChatHistoryMatch[]> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Search for similar chat history entries
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_chat_history", {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
      target_user_id: userId,
    });

    if (error) {
      console.error("Error searching chat history:", error);
      throw new Error("Failed to search chat history");
    }

    return data || [];
  } catch (error) {
    console.error("Error in searchChatHistory:", error);
    throw error;
  }
}

export function formatContextForRAG(matches: ChatHistoryMatch[]): string {
  if (matches.length === 0) {
    return "No relevant chat history found.";
  }

  const contextParts = matches.map((match, index) => {
    const date = formatChatDate(match.message_date);
    const creator = match.creator_name || match.participant_name;
    const email = match.creator_email ? ` (${match.creator_email})` : "";
    const topic = match.topic_id ? ` [Topic: ${match.topic_id}]` : "";

    return `[${index + 1}] ${creator}${email} (${date})${topic}: ${
      match.message_content
    }`;
  });

  return `Relevant chat history:\n\n${contextParts.join("\n\n")}`;
}

// New: formatter for chunk search results
type ChunkSearchRow = {
  id: string;
  content: string;
  participants: string[];
  start_time: string | null;
  end_time: string | null;
  original_filename: string | null;
  similarity: number;
};

export function formatChunksForRAG(rows: ChunkSearchRow[]): string {
  if (!rows || rows.length === 0) return "No relevant chat history found.";
  const parts = rows.map((r, idx) => {
    const when = formatChatDate(r.start_time || r.end_time || null);
    const who = r.participants.join(", ");
    return `[${idx + 1}] ${who} (${when}) [${(r.similarity * 100).toFixed(
      1
    )}%]:\n${r.content}`;
  });
  return `Relevant chat history (chunked):\n\n${parts.join("\n\n")}`;
}

export async function processUserQuery(
  query: string,
  userId: string
): Promise<string> {
  try {
    // Use hybrid chunk search going forward
    const [rows, coverage] = await Promise.all([
      hybridSearch(query, userId),
      getUserCorpusCoverage(userId),
    ]);
    const context = formatChunksForRAG(rows as ChunkSearchRow[]);
    const coverageHeader = coverage
      ? `Corpus coverage: earliest ${coverage.earliest}, latest ${coverage.latest}, total chunks ${coverage.totalChunks}.\n\n`
      : "";
    return coverageHeader + context;
  } catch (error) {
    console.error("Error processing user query:", error);
    throw new Error("Failed to process query");
  }
}

export async function checkForDuplicateMessage(
  userId: string,
  messageContent: string,
  messageId?: string,
  topicId?: string
): Promise<boolean> {
  try {
    const supabase = await createClient();

    // Build query conditions
    const query = supabase
      .from("chat_history")
      .select("id")
      .eq("user_id", userId)
      .eq("message_content", messageContent);

    // If we have a message_id, check for exact match first
    if (messageId) {
      const { data: exactMatch, error: exactError } = await query
        .eq("message_id", messageId)
        .limit(1);

      if (!exactError && exactMatch && exactMatch.length > 0) {
        return true;
      }
    }

    // If we have a topic_id, check for topic match
    if (topicId) {
      const { data: topicMatch, error: topicError } = await query
        .eq("topic_id", topicId)
        .limit(1);

      if (!topicError && topicMatch && topicMatch.length > 0) {
        return true;
      }
    }

    // Final check: just content match (most lenient)
    const { data, error } = await query.limit(1);

    if (error) {
      console.error("Error checking for duplicates:", error);
      return false; // Assume not duplicate if we can't check
    }

    return data && data.length > 0;
  } catch (error) {
    console.error("Error in checkForDuplicateMessage:", error);
    return false;
  }
}

// Retry function with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export async function embedChatHistoryEntry(
  userId: string,
  participantName: string,
  messageContent: string,
  messageDate: string | null,
  originalFilename: string,
  metadata: Record<string, unknown> = {},
  creatorInfo?: {
    name: string;
    email: string;
    user_type: string;
  },
  topicId?: string,
  messageId?: string
): Promise<string | null | { error: true; message: string; details: unknown }> {
  try {
    const supabase = await createClient();

    // Check for duplicates first
    const isDuplicate = await checkForDuplicateMessage(
      userId,
      messageContent,
      messageId,
      topicId
    );

    if (isDuplicate) {
      console.log(
        `Skipping duplicate message: ${messageContent.substring(0, 50)}...`
      );
      return null; // Return null to indicate this was skipped
    }

    // Create the chat history entry with retry logic
    const historyEntry = await retryWithBackoff(async () => {
      const { data, error } = await supabase
        .from("chat_history")
        .insert({
          user_id: userId,
          participant_name: participantName,
          message_content: messageContent,
          message_date: messageDate,
          original_filename: originalFilename,
          creator_name: creatorInfo?.name || null,
          creator_email: creatorInfo?.email || null,
          creator_user_type: creatorInfo?.user_type || null,
          topic_id: topicId || null,
          message_id: messageId || null,
          metadata,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    });

    // Generate embedding for the message content with retry logic
    const embedding = await retryWithBackoff(async () => {
      return await generateEmbedding(messageContent);
    });

    // Store the embedding with retry logic
    await retryWithBackoff(async () => {
      const { error } = await supabase.from("chat_embeddings").insert({
        chat_history_id: historyEntry.id,
        embedding,
      });

      if (error) throw error;
    });

    return historyEntry.id;
  } catch (error) {
    console.error("Error embedding chat history entry:", error);

    // Return a special error object instead of throwing
    return {
      error: true,
      message: error instanceof Error ? error.message : "Unknown error",
      details: error,
    };
  }
}

// --- Chunking + hybrid search API ---

function sha256(input: string): string {
  // Simple browser/node compatible sha256 via SubtleCrypto if available; fallback to a cheap hash (collision-resistant not required for UX)
  // For server-side Next.js, using Web Crypto API is fine, but to keep it simple here use a lightweight sync hash.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

type NormalizedMsg = {
  content: string;
  timestamp: string | null;
  participant: string;
  email?: string;
};

export function windowMessagesIntoChunks(
  messages: NormalizedMsg[],
  targetChars = 1000,
  minChars = 400,
  maxChars = 1600
) {
  const chunks: Array<{
    content: string;
    start: string | null;
    end: string | null;
    participants: Set<string>;
    participantEmails: Set<string>;
    count: number;
  }> = [];

  let current = {
    content: "",
    start: null as string | null,
    end: null as string | null,
    participants: new Set<string>(),
    participantEmails: new Set<string>(),
    count: 0,
  };

  const pushCurrent = () => {
    if (current.content.trim().length === 0) return;
    chunks.push({
      ...current,
      participants: new Set(current.participants),
      participantEmails: new Set(current.participantEmails),
    });
    current = {
      content: "",
      start: null,
      end: null,
      participants: new Set(),
      participantEmails: new Set(),
      count: 0,
    };
  };

  const isTrivial = (t: string) =>
    t.trim().length < 2 || /^(ok|k|lol|haha|thx|thanks|👍|👌)$/i.test(t.trim());

  for (const m of messages) {
    if (!m.content || isTrivial(m.content)) continue;
    const addition =
      (current.content ? "\n" : "") + `${m.participant}: ${m.content}`;
    if (
      current.content.length + addition.length > maxChars &&
      current.content.length >= minChars
    ) {
      pushCurrent();
    }
    if (current.content.length === 0) {
      current.start = m.timestamp;
    }
    current.content += addition;
    current.end = m.timestamp;
    current.participants.add(m.participant);
    if (m.email) current.participantEmails.add(m.email);
    current.count += 1;
    if (current.content.length >= targetChars) {
      pushCurrent();
    }
  }
  pushCurrent();

  return chunks.map((c) => ({
    content: c.content,
    start: c.start,
    end: c.end,
    participants: Array.from(c.participants),
    participantEmails: Array.from(c.participantEmails),
    count: c.count,
  }));
}

export async function upsertChunksAndEmbed(
  userId: string,
  chunks: Array<{
    content: string;
    start: string | null;
    end: string | null;
    participants: string[];
    participantEmails?: string[];
    count: number;
  }>,
  originalFilename?: string
) {
  const supabase = await createClient();

  // Compute hashes for dedupe
  const rows = chunks.map((c) => ({
    content: c.content,
    start: c.start,
    end: c.end,
    participants: c.participants,
    participantEmails: c.participantEmails ?? [],
    hash: sha256(
      `${c.participants.join(",")}|${c.start}|${c.end}|${c.content}`
    ),
    message_count: c.count,
  }));

  // Insert or ignore existing by unique hash (batched to avoid timeouts)
  let insertedCount = 0;
  const insertBatchSize = 400;
  for (let i = 0; i < rows.length; i += insertBatchSize) {
    const slice = rows.slice(i, i + insertBatchSize).map((r) => ({
      user_id: userId,
      chunk_hash: r.hash,
      participants: r.participants,
      participants_emails: r.participantEmails,
      content: r.content,
      start_time: r.start,
      end_time: r.end,
      message_count: r.message_count,
      original_filename: originalFilename,
    }));
    const { data, error } = await supabase
      .from("chat_chunks")
      .upsert(slice, { onConflict: "chunk_hash" })
      .select("id");
    if (error) throw error;
    insertedCount += data?.length ?? 0;
  }

  // Find rows missing embeddings and process in pages
  let totalEmbedded = 0;
  const pageSize = 1000;
  for (;;) {
    const { data: page, error: selErr } = await supabase
      .from("chat_chunks")
      .select("id, content")
      .eq("user_id", userId)
      .is("embedding", null)
      .limit(pageSize);

    if (selErr) throw selErr;
    if (!page || page.length === 0) break;

    const embeddings = await generateEmbeddingsBatch(
      page.map((r) => r.content)
    );

    // Batch updates in small groups to avoid payload size/timeouts
    const updateBatchSize = 200;
    for (let i = 0; i < page.length; i += updateBatchSize) {
      const sliceIds = page.slice(i, i + updateBatchSize).map((r) => r.id);
      const sliceEmb = embeddings.slice(i, i + updateBatchSize);
      // Update each row; Supabase bulk update by array not natively supported unless using RPC
      for (let k = 0; k < sliceIds.length; k++) {
        const { error: updErr } = await supabase
          .from("chat_chunks")
          .update({ embedding: sliceEmb[k] as unknown as number[] })
          .eq("id", sliceIds[k]);
        if (updErr) throw updErr;
      }
      totalEmbedded += sliceIds.length;
    }
  }

  return { inserted: insertedCount, embedded: totalEmbedded };
}

export async function hybridSearch(query: string, userId: string) {
  const supabase = await createClient();
  const embed = await generateEmbedding(query);
  const { data, error } = await supabase.rpc("search_chat_chunks_hybrid", {
    query_text: query,
    query_embedding: embed,
    match_threshold: 0.2,
    lexical_limit: 5000,
    final_k: 50,
    target_user_id: userId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getUserCorpusCoverage(userId: string): Promise<{
  earliest: string;
  latest: string;
  totalChunks: number;
} | null> {
  const supabase = await createClient();
  // Use ordered selects to compute earliest/latest and a head-count for total
  const [
    earliestStartRes,
    earliestEndRes,
    latestEndRes,
    latestStartRes,
    countRes,
  ] = await Promise.all([
    supabase
      .from("chat_chunks")
      .select("start_time")
      .eq("user_id", userId)
      .not("start_time", "is", null)
      .order("start_time", { ascending: true })
      .limit(1),
    supabase
      .from("chat_chunks")
      .select("end_time")
      .eq("user_id", userId)
      .not("end_time", "is", null)
      .order("end_time", { ascending: true })
      .limit(1),
    supabase
      .from("chat_chunks")
      .select("end_time")
      .eq("user_id", userId)
      .not("end_time", "is", null)
      .order("end_time", { ascending: false })
      .limit(1),
    supabase
      .from("chat_chunks")
      .select("start_time")
      .eq("user_id", userId)
      .not("start_time", "is", null)
      .order("start_time", { ascending: false })
      .limit(1),
    supabase
      .from("chat_chunks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const earliestCandidates: Array<string> = [];
  const latestCandidates: Array<string> = [];
  const es = (
    earliestStartRes.data as Array<{ start_time: string }> | null
  )?.[0]?.start_time;
  const ee = (earliestEndRes.data as Array<{ end_time: string }> | null)?.[0]
    ?.end_time;
  const le = (latestEndRes.data as Array<{ end_time: string }> | null)?.[0]
    ?.end_time;
  const ls = (latestStartRes.data as Array<{ start_time: string }> | null)?.[0]
    ?.start_time;
  if (es) earliestCandidates.push(es);
  if (ee) earliestCandidates.push(ee);
  if (le) latestCandidates.push(le);
  if (ls) latestCandidates.push(ls);

  const pickMin = (vals: string[]) =>
    vals.length === 0
      ? null
      : vals.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
  const pickMax = (vals: string[]) =>
    vals.length === 0
      ? null
      : vals.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));

  const earliest = formatChatDate(pickMin(earliestCandidates));
  const latest = formatChatDate(pickMax(latestCandidates));
  const totalChunks = countRes.count ?? 0;
  return { earliest, latest, totalChunks };
}
