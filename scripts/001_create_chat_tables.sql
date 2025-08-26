-- Create extension for vector operations (pgvector)
create extension if not exists vector;

-- Create chat_threads table for bot conversations
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create chat_messages table for individual messages in bot conversations
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.chat_threads(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create chat_history table for storing original JSON chat data
create table if not exists public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  original_filename text not null,
  participant_name text not null,
  message_content text not null,
  message_date timestamp with time zone,
  metadata jsonb default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create chat_embeddings table for vector search
create table if not exists public.chat_embeddings (
  id uuid primary key default gen_random_uuid(),
  chat_history_id uuid references public.chat_history(id) on delete cascade not null,
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_history enable row level security;
alter table public.chat_embeddings enable row level security;

-- Create RLS policies for chat_threads
create policy "Users can view their own chat threads"
  on public.chat_threads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own chat threads"
  on public.chat_threads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own chat threads"
  on public.chat_threads for update
  using (auth.uid() = user_id);

create policy "Users can delete their own chat threads"
  on public.chat_threads for delete
  using (auth.uid() = user_id);

-- Create RLS policies for chat_messages
create policy "Users can view messages from their threads"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_messages.thread_id
      and chat_threads.user_id = auth.uid()
    )
  );

create policy "Users can insert messages to their threads"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_messages.thread_id
      and chat_threads.user_id = auth.uid()
    )
  );

-- Create RLS policies for chat_history
create policy "Users can view their own chat history"
  on public.chat_history for select
  using (auth.uid() = user_id);

create policy "Users can insert their own chat history"
  on public.chat_history for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own chat history"
  on public.chat_history for update
  using (auth.uid() = user_id);

create policy "Users can delete their own chat history"
  on public.chat_history for delete
  using (auth.uid() = user_id);

-- Create RLS policies for chat_embeddings
create policy "Users can view embeddings for their chat history"
  on public.chat_embeddings for select
  using (
    exists (
      select 1 from public.chat_history
      where chat_history.id = chat_embeddings.chat_history_id
      and chat_history.user_id = auth.uid()
    )
  );

create policy "Users can insert embeddings for their chat history"
  on public.chat_embeddings for insert
  with check (
    exists (
      select 1 from public.chat_history
      where chat_history.id = chat_embeddings.chat_history_id
      and chat_history.user_id = auth.uid()
    )
  );
