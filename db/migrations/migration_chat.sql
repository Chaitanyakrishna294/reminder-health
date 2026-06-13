-- Create the chat_messages table to store real messages between patients and caregivers
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow users to read messages where they are either the sender or the recipient
CREATE POLICY "Users can view their own chat messages" ON public.chat_messages
    FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Allow users to insert messages only if they are the sender
CREATE POLICY "Users can insert their own chat messages" ON public.chat_messages
    FOR INSERT
    WITH CHECK (auth.uid() = sender_id);

-- Enable real-time updates for this table so messages update instantly on both screens
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
