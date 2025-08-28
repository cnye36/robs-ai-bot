-- Make knowledge base retrieval global (no per-user filtering)
-- This preserves existing function signatures to avoid app code changes,
-- but removes the user_id filter internally. Functions run as SECURITY DEFINER
-- to bypass RLS while keeping table RLS in place for direct selects.

-- 1) search_chat_history: remove user_id filter
drop function if exists search_chat_history(vector, float, int, uuid);
create or replace function search_chat_history(
  query_embedding vector(1536),
  match_threshold float default 0.78,
  match_count int default 10,
  target_user_id uuid default auth.uid()
)
returns table (
  id uuid,
  participant_name text,
  creator_name text,
  creator_email text,
  creator_user_type text,
  message_content text,
  message_date timestamp with time zone,
  topic_id text,
  message_id text,
  original_filename text,
  similarity float
)
language plpgsql
security definer
as $$
begin
  perform set_config('ivfflat.probes', '10', true);
  return query
  with candidates as (
    select
      ce.chat_history_id,
      1 - (ce.embedding <=> query_embedding) as similarity
    from public.chat_embeddings ce
    order by ce.embedding <=> query_embedding
    limit greatest(match_count * 10, 50)
  )
  select
    ch.id,
    ch.participant_name,
    ch.creator_name,
    ch.creator_email,
    ch.creator_user_type,
    ch.message_content,
    ch.message_date,
    ch.topic_id,
    ch.message_id,
    ch.original_filename,
    c.similarity
  from candidates c
  join public.chat_history ch on ch.id = c.chat_history_id
  where c.similarity > match_threshold
  order by c.similarity desc
  limit match_count;
end;
$$;

-- 2) search_chat_chunks_hybrid: remove user_id filter in lexical CTE
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

-- 3) Global coverage helper for UI context header
drop function if exists get_chat_chunks_coverage();
create or replace function get_chat_chunks_coverage()
returns table (
  earliest timestamp with time zone,
  latest timestamp with time zone,
  total_chunks bigint
)
language plpgsql
security definer
as $$
begin
  return query
  with ordered as (
    select start_time, end_time
    from public.chat_chunks
    where start_time is not null or end_time is not null
  ),
  extremes as (
    select
      least(
        coalesce(min(start_time), 'infinity'::timestamp),
        coalesce(min(end_time), 'infinity'::timestamp)
      ) as earliest,
      greatest(
        coalesce(max(start_time), '-infinity'::timestamp),
        coalesce(max(end_time), '-infinity'::timestamp)
      ) as latest
    from ordered
  ),
  tally as (
    select count(*)::bigint as total from public.chat_chunks
  )
  select e.earliest, e.latest, t.total from extremes e cross join tally t;
end;
$$;


