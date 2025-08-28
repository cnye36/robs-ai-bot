"use client"
import type { User } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Plus,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  LogOut,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useRef } from "react";

interface ChatThread {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface ChatSidebarProps {
  threads: ChatThread[]
  activeThreadId: string | null
  onThreadSelect: (threadId: string) => void
  onNewThread: () => void
  onDeleteThread: (threadId: string) => void
  user: User
}

export function ChatSidebar({
  threads,
  activeThreadId,
  onThreadSelect,
  onNewThread,
  onDeleteThread,
  user,
}: ChatSidebarProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    } else if (diffInHours < 24 * 7) {
      return date.toLocaleDateString([], { weekday: "short" })
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" })
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      alert("Please upload a JSON file containing your chat history.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("filename", file.name);

    try {
      const response = await fetch("/api/upload-chat-history", {
        method: "POST",
        body: formData,
      });

      let result;
      const contentType = response.headers.get("content-type");

      if (contentType && contentType.includes("application/json")) {
        result = await response.json();
      } else {
        // Handle HTML error pages or plain text responses
        const text = await response.text();
        result = {
          error: `Server error: ${response.status} ${response.statusText}`,
        };
        console.error("Non-JSON response:", text);
      }

      if (response.ok && result.success) {
        alert(
          `Successfully processed ${result.processed} messages from your chat history!`
        );
      } else {
        alert(
          `Error uploading file: ${result.error || "Unknown error occurred"}`
        );
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert(
        "Error uploading file. Please check your connection and try again."
      );
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-105 bg-sidebar border-r border-sidebar-border flex flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-sidebar-foreground">
            Chat History
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs bg-sidebar-accent text-sidebar-accent-foreground">
                    {user.email?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          onClick={onNewThread}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2">
          {threads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No chats yet</p>
              <p className="text-xs">Start a new conversation</p>
            </div>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                className={`group relative flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  activeThreadId === thread.id
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent/50"
                }`}
                onClick={() => onThreadSelect(thread.id)}
              >
                <div className="flex-1 min-w-0 pr-10">
                  <p
                    className="text-sm font-medium truncate"
                    title={thread.title}
                  >
                    {thread.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(thread.updated_at)}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-90 hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteThread(thread.id);
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <div className="space-y-2 p-2 border-t border-sidebar-border">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-3 w-3" />
          Sign out
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-2 h-3 w-3" />
          Upload Chat History
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          className="hidden"
        />
        <p className="text-xs text-muted-foreground">
          Upload a JSON file containing your chat history to enable intelligent
          search
        </p>
      </div>
    </div>
  );
}
