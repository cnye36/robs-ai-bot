-- Add participants_emails to chat_chunks for richer context
alter table public.chat_chunks
  add column if not exists participants_emails text[] default '{}';

-- Optional index if you plan to filter by email
create index if not exists idx_chat_chunks_participants_emails on public.chat_chunks using gin (participants_emails);

