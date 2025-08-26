-- Chunked chat storage with hybrid retrieval (lexical + vector)

-- Requires pgvector extension
create extension if not exists vector;

-- Table: chat_chunks
create table if not exists public.chat_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  chunk_hash text not null,
  participants text[] default '{}',
  content text not null,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  message_count int not null default 0,
  original_filename text,
  metadata jsonb default '{}',
  embedding vector(1536),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Unique constraint for dedupe
create unique index if not exists idx_chat_chunks_hash on public.chat_chunks(chunk_hash);

-- Indexes
create index if not exists idx_chat_chunks_user_id on public.chat_chunks(user_id);
create index if not exists idx_chat_chunks_time on public.chat_chunks(start_time);
create index if not exists idx_chat_chunks_filename on public.chat_chunks(original_filename);

-- Full-text GIN index
create index if not exists idx_chat_chunks_fts on public.chat_chunks using gin (to_tsvector('english', content));

-- Vector ANN index
create index if not exists idx_chat_chunks_embedding on public.chat_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RLS
alter table public.chat_chunks enable row level security;



-- Hybrid search function
drop function if exists search_chat_chunks_hybrid(text, vector, float, int, int, uuid);
create or replace function search_chat_chunks_hybrid(
  query_text text,
  query_embedding vector(1536),
  match_threshold float default 0.20,
  lexical_limit int default 300,
  final_k int default 20,
  target_user_id uuid default auth.uid()
)
returns table (
  chunk_id uuid,
  content text,
  participants text[],
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  original_filename text,
  similarity float
)
language plpgsql
security definer
as $$
begin
  perform set_config('ivfflat.probes', '10', true);
  return query
  select
    c.id as chunk_id,
    c.content,
    c.participants,
    c.start_time,
    c.end_time,
    c.original_filename,
    1 - (c.embedding <=> query_embedding) as similarity
  from (
    with lexical as (
      select cc.id
      from public.chat_chunks as cc
      where cc.user_id = target_user_id
      order by ts_rank_cd(to_tsvector('english', cc.content), plainto_tsquery('english', query_text)) desc
      limit lexical_limit
    )
    select cc.*
    from lexical l
    join public.chat_chunks cc on cc.id = l.id
  ) as c
  where 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit final_k;
end;
$$;


