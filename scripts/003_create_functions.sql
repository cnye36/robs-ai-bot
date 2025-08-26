-- Function to search chat history using vector similarity
create or replace function search_chat_history(
  query_embedding vector(1536),
  match_threshold float default 0.78,
  match_count int default 10,
  target_user_id uuid default auth.uid()
)
returns table (
  id uuid,
  participant_name text,
  message_content text,
  message_date timestamp with time zone,
  original_filename text,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    ch.id,
    ch.participant_name,
    ch.message_content,
    ch.message_date,
    ch.original_filename,
    1 - (ce.embedding <=> query_embedding) as similarity
  from public.chat_history ch
  join public.chat_embeddings ce on ch.id = ce.chat_history_id
  where ch.user_id = target_user_id
    and 1 - (ce.embedding <=> query_embedding) > match_threshold
  order by ce.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Function to update thread updated_at timestamp
create or replace function update_thread_timestamp()
returns trigger
language plpgsql
as $$
begin
  update public.chat_threads
  set updated_at = timezone('utc'::text, now())
  where id = new.thread_id;
  return new;
end;
$$;

-- Create trigger to update thread timestamp when messages are added
drop trigger if exists update_thread_timestamp_trigger on public.chat_messages;
create trigger update_thread_timestamp_trigger
  after insert on public.chat_messages
  for each row
  execute function update_thread_timestamp();
