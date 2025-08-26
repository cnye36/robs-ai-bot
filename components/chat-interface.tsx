"use client"

import { useState, useEffect } from "react"
import type { User } from "@supabase/supabase-js"
import { ChatSidebar } from "./chat-sidebar"
import { ChatArea } from "./chat-area"
import { createClient } from "@/lib/supabase/client"

interface ChatThread {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface ChatInterfaceProps {
  user: User
}

export function ChatInterface({ user }: ChatInterfaceProps) {
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadChatThreads()
  }, [])

  const loadChatThreads = async () => {
    const supabase = createClient()
    const { data, error } = await supabase.from("chat_threads").select("*").order("updated_at", { ascending: false })

    if (error) {
      console.error("Error loading chat threads:", error)
    } else {
      setThreads(data || [])
      if (data && data.length > 0 && !activeThreadId) {
        setActiveThreadId(data[0].id)
      }
    }
    setIsLoading(false)
  }

  const createNewThread = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({
        user_id: user.id,
        title: "New Chat",
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating new thread:", error)
    } else {
      setThreads([data, ...threads])
      setActiveThreadId(data.id)
    }
  }

  const updateThreadTitle = async (threadId: string, title: string) => {
    const supabase = createClient()
    const { error } = await supabase.from("chat_threads").update({ title }).eq("id", threadId)

    if (error) {
      console.error("Error updating thread title:", error)
    } else {
      setThreads(threads.map((t) => (t.id === threadId ? { ...t, title } : t)))
    }
  }

  const deleteThread = async (threadId: string) => {
    const supabase = createClient()
    const { error } = await supabase.from("chat_threads").delete().eq("id", threadId)

    if (error) {
      console.error("Error deleting thread:", error)
    } else {
      const newThreads = threads.filter((t) => t.id !== threadId)
      setThreads(newThreads)
      if (activeThreadId === threadId) {
        setActiveThreadId(newThreads.length > 0 ? newThreads[0].id : null)
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <ChatSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onThreadSelect={setActiveThreadId}
        onNewThread={createNewThread}
        onDeleteThread={deleteThread}
        user={user}
      />
      <ChatArea threadId={activeThreadId} onUpdateThreadTitle={updateThreadTitle} user={user} />
    </div>
  )
}
