import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { processUserQuery } from "@/lib/rag"
import { generateChatResponse } from "@/lib/openai"

export async function POST(request: NextRequest) {
  try {
    const { message, threadId } = await request.json()

    if (!message || !threadId) {
      return NextResponse.json({ error: "Message and threadId are required" }, { status: 400 })
    }

    // Get user from session
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Verify thread belongs to user
    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", user.id)
      .single()

    if (threadError || !thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    // Get recent conversation context
    const { data: recentMessages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(10)

    if (messagesError) {
      console.error("Error fetching recent messages:", messagesError)
    }

    // Reverse to get chronological order
    const conversationHistory = (recentMessages || []).reverse()

    // Search for relevant chat history using RAG
    const ragContext = await processUserQuery(message, user.id)
    console.log("RAG context:", ragContext);

    // Generate AI response using conversation history and RAG context
    const aiResponse = await generateChatResponse(
      [...conversationHistory, { role: "user", content: message }],
      ragContext
    );

    // Save the AI response to the database
    const { data: savedMessage, error: saveError } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        role: "assistant",
        content: aiResponse,
      })
      .select()
      .single()

    if (saveError) {
      console.error("Error saving AI response:", saveError)
      return NextResponse.json({ error: "Failed to save response" }, { status: 500 })
    }

    return NextResponse.json({
      message: savedMessage,
      context: ragContext,
    })
  } catch (error) {
    console.error("Error in chat API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
