-- Create indexes for better performance

-- Index for chat_threads
create index if not exists idx_chat_threads_user_id on public.chat_threads(user_id);
create index if not exists idx_chat_threads_created_at on public.chat_threads(created_at desc);

-- Index for chat_messages
create index if not exists idx_chat_messages_thread_id on public.chat_messages(thread_id);
create index if not exists idx_chat_messages_created_at on public.chat_messages(created_at);

-- Index for chat_history
create index if not exists idx_chat_history_user_id on public.chat_history(user_id);
create index if not exists idx_chat_history_participant on public.chat_history(participant_name);
create index if not exists idx_chat_history_date on public.chat_history(message_date);
create index if not exists idx_chat_history_filename on public.chat_history(original_filename);

-- Index for chat_embeddings (vector similarity search)
create index if not exists idx_chat_embeddings_vector on public.chat_embeddings 
using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Index for chat_embeddings foreign key
create index if not exists idx_chat_embeddings_history_id on public.chat_embeddings(chat_history_id);
