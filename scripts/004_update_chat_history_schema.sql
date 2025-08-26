-- Update chat_history table to better accommodate the new JSON structure
-- Add new columns for creator information and message identifiers

-- Add new columns to chat_history table
ALTER TABLE public.chat_history 
ADD COLUMN IF NOT EXISTS creator_name text,
ADD COLUMN IF NOT EXISTS creator_email text,
ADD COLUMN IF NOT EXISTS creator_user_type text,
ADD COLUMN IF NOT EXISTS topic_id text,
ADD COLUMN IF NOT EXISTS message_id text;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_chat_history_creator_name ON public.chat_history(creator_name);
CREATE INDEX IF NOT EXISTS idx_chat_history_creator_email ON public.chat_history(creator_email);
CREATE INDEX IF NOT EXISTS idx_chat_history_topic_id ON public.chat_history(topic_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_message_id ON public.chat_history(message_id);

-- Drop the existing function first, then recreate it with new return type
DROP FUNCTION IF EXISTS search_chat_history(vector,double precision,integer,uuid);

-- Create the updated search function with new fields
CREATE OR REPLACE FUNCTION search_chat_history(
  query_embedding vector(1536),
  match_threshold float default 0.78,
  match_count int default 10,
  target_user_id uuid default auth.uid()
)
RETURNS TABLE (
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Improve recall/speed trade-off for IVFFlat
  PERFORM set_config('ivfflat.probes', '10', true);

  RETURN QUERY
  WITH candidates AS (
    SELECT
      ce.chat_history_id,
      1 - (ce.embedding <=> query_embedding) AS similarity
    FROM public.chat_embeddings ce
    ORDER BY ce.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 10, 50)
  )
  SELECT
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
  FROM candidates c
  JOIN public.chat_history ch ON ch.id = c.chat_history_id
  WHERE ch.user_id = target_user_id
    AND c.similarity > match_threshold
  ORDER BY c.similarity DESC
  LIMIT match_count;
END;
$$;
