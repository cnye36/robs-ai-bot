"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import type { User } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Send, Bot } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string
}

interface ChatAreaProps {
  threadId: string | null
  onUpdateThreadTitle: (threadId: string, title: string) => void
  user: User
}

export function ChatArea({ threadId, onUpdateThreadTitle, user }: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  type CodeProps = React.ComponentPropsWithoutRef<'code'> & { inline?: boolean }
  const CodeRenderer = ({ inline, className, children, ...props }: CodeProps) => {
    const languageMatch = /language-(\w+)/.exec(className || "")
    if (inline) {
      return (
        <code
          className="rounded px-1.5 py-0.5 bg-black/20 dark:bg-white/20 font-mono text-[0.875em]"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background/70 p-3">
        <code className={languageMatch ? className : undefined} {...props}>
          {children}
        </code>
      </pre>
    )
  }


  useEffect(() => {
    if (threadId) {
      loadMessages()
    } else {
      setMessages([])
    }
  }, [threadId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const loadMessages = async () => {
    if (!threadId) return

    setIsLoadingMessages(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Error loading messages:", error)
    } else {
      setMessages(data || [])
    }
    setIsLoadingMessages(false)
  }

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]")
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !threadId || isLoading) return

    const userMessage = input.trim()
    setInput("")
    setIsLoading(true)

    // Add user message to UI immediately
    const tempUserMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const supabase = createClient()

      // Save user message to database
      const { data: savedUserMessage, error: userError } = await supabase
        .from("chat_messages")
        .insert({
          thread_id: threadId,
          role: "user",
          content: userMessage,
        })
        .select()
        .single()

      if (userError) throw userError

      // Update the temporary message with the real one
      setMessages((prev) => prev.map((msg) => (msg.id === tempUserMessage.id ? savedUserMessage : msg)))

      // Update thread title if it's the first message
      if (messages.length === 0) {
        const title = userMessage.length > 50 ? userMessage.substring(0, 50) + "..." : userMessage
        onUpdateThreadTitle(threadId, title)
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          threadId: threadId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get AI response")
      }

      const { message: assistantMessage } = await response.json()
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Error sending message:", error)
      // Remove the temporary message on error
      setMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessage.id))

      // Add error message
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "I apologize, but I encountered an error processing your request. Please try again.",
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  

  if (!threadId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <Bot className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Welcome to your RAG Chatbot</h2>
          <p className="text-muted-foreground mb-4">
            Start a new conversation or select an existing chat from the sidebar
          </p>
          
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Messages Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Bot className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground mb-4">Start a conversation</p>
              
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {messages.map((message) => (
              (() => {
                const markdownComponents: Components = {
                  code: CodeRenderer,
                  a({ children, ...props }) {
                    return (
                      <a
                        className="underline underline-offset-2 hover:opacity-80"
                        target="_blank"
                        rel="noreferrer noopener"
                        {...props}
                      >
                        {children as React.ReactNode}
                      </a>
                    )
                  },
                  ul(props) {
                    return <ul className="list-disc pl-5 my-2 space-y-1" {...props} />
                  },
                  ol(props) {
                    return <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />
                  },
                  li(props) {
                    return <li className="my-1" {...props} />
                  },
                  p(props) {
                    return <p className="my-2" {...props} />
                  },
                  h1(props) {
                    return <h1 className="text-lg font-semibold my-2" {...props} />
                  },
                  h2(props) {
                    return <h2 className="text-base font-semibold my-2" {...props} />
                  },
                  h3(props) {
                    return <h3 className="text-base font-medium my-2" {...props} />
                  },
                  blockquote(props) {
                    return <blockquote className="border-l-4 pl-3 my-2 opacity-80" {...props} />
                  },
                  table(props) {
                    return (
                      <div className="my-2 overflow-x-auto">
                        <table className="min-w-full border-collapse" {...props} />
                      </div>
                    )
                  },
                  th(props) {
                    return <th className="border px-2 py-1 text-left" {...props} />
                  },
                  td(props) {
                    return <td className="border px-2 py-1 align-top" {...props} />
                  },
                }
                return (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <Avatar className="h-8 w-8 bg-primary">
                    <AvatarFallback>
                      <Bot className="h-4 w-4 text-primary-foreground" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-card-foreground border"
                  }`}
                >
                  <div className="text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
                {message.role === "user" && (
                  <Avatar className="h-8 w-8 bg-secondary">
                    <AvatarFallback className="text-secondary-foreground">
                      {user.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
                )
              })()
            ))}
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <Avatar className="h-8 w-8 bg-primary">
                  <AvatarFallback>
                    <Bot className="h-4 w-4 text-primary-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-card text-card-foreground border rounded-lg px-4 py-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your chat history..."
              className="flex-1 min-h-[44px] max-h-32 resize-none bg-input"
              disabled={isLoading}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isLoading}
              className="h-11 px-4 bg-primary hover:bg-primary/90"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
