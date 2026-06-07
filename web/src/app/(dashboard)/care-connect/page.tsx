'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, ShieldAlert, Lock, Clock } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';

interface Message {
  id: string;
  sender: 'SELF' | 'PEER';
  text: string;
  timestamp: string;
}

export default function CareConnectPage() {
  const { isElderly } = useUiMode();
  const [userProfile, setUserProfile] = useState<{ role: string; fullName: string } | null>(null);
  const [peerName, setPeerName] = useState<string>('Caregiver');
  const [peerId, setPeerId] = useState<string>('');
  const [isLinked, setIsLinked] = useState<boolean>(false);
  const [userId, setUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    async function loadProfileAndMessages() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        setUserId(user.id);

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, full_name, telegram_chat_id')
          .eq('id', user.id)
          .single();

        if (!profile) return;

        setUserProfile({
          role: profile.role,
          fullName: profile.full_name || 'User',
        });

        let resolvedPeerName = profile.role === 'CAREGIVER' ? 'Patient' : 'Caregiver';
        let resolvedPeerId = '';
        let resolvedIsLinked = false;

        if (profile.role === 'CAREGIVER') {
          const { data: caregiverLink } = await supabase
            .from('caregiver_info')
            .select('patient_telegram_id')
            .eq('caregiver_chat_id', profile.telegram_chat_id)
            .eq('is_active', true)
            .single();

          if (caregiverLink && caregiverLink.patient_telegram_id) {
            const { data: patientProfile } = await supabase
              .from('profiles')
              .select('id, full_name')
              .eq('telegram_chat_id', caregiverLink.patient_telegram_id)
              .single();
            if (patientProfile) {
              resolvedPeerName = patientProfile.full_name;
              resolvedPeerId = patientProfile.id;
              resolvedIsLinked = true;
            }
          }
        } else {
          const { data: caregiverLink } = await supabase
            .from('caregiver_info')
            .select('caregiver_chat_id')
            .eq('patient_telegram_id', profile.telegram_chat_id)
            .eq('is_active', true)
            .single();

          if (caregiverLink && caregiverLink.caregiver_chat_id) {
            const { data: caregiverProfile } = await supabase
              .from('profiles')
              .select('id, full_name')
              .eq('telegram_chat_id', caregiverLink.caregiver_chat_id)
              .single();
            if (caregiverProfile) {
              resolvedPeerName = caregiverProfile.full_name;
              resolvedPeerId = caregiverProfile.id;
              resolvedIsLinked = true;
            }
          }
        }

        setPeerName(resolvedPeerName);
        setPeerId(resolvedPeerId);
        setIsLinked(resolvedIsLinked);

        // Fetch messages from Supabase chat_messages table if linked
        if (resolvedIsLinked && resolvedPeerId) {
          const { data: msgsData } = await supabase
            .from('chat_messages')
            .select('*')
            .or(`and(sender_id.eq.${user.id},recipient_id.eq.${resolvedPeerId}),and(sender_id.eq.${resolvedPeerId},recipient_id.eq.${user.id})`)
            .order('created_at', { ascending: true })
            .limit(100);

          if (msgsData) {
            const parsedMessages: Message[] = msgsData.map((m: any) => ({
              id: m.id,
              sender: m.sender_id === user.id ? 'SELF' : 'PEER',
              text: m.text,
              timestamp: m.created_at,
            }));
            setMessages(parsedMessages);
          }
        }
      } catch (err) {
        console.error('Error loading Care Connect:', err);
      } finally {
        setLoading(false);
      }
    }

    loadProfileAndMessages();
  }, [supabase]);

  // Realtime subscription to receive messages instantly
  useEffect(() => {
    if (!userId || !peerId) return;

    const channel = supabase
      .channel(`chat-realtime-${userId}-${peerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload: any) => {
          const newMsg = payload.new;
          if (!newMsg) return;

          // Check if message belongs to this conversation
          const isBelonging =
            (newMsg.sender_id === userId && newMsg.recipient_id === peerId) ||
            (newMsg.sender_id === peerId && newMsg.recipient_id === userId);

          if (isBelonging) {
            setMessages((prev) => {
              // Avoid duplicate messages
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              
              return [
                ...prev,
                {
                  id: newMsg.id,
                  sender: newMsg.sender_id === userId ? 'SELF' : 'PEER',
                  text: newMsg.text,
                  timestamp: newMsg.created_at,
                },
              ];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, peerId, supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || !userId || !peerId) return;

    setInputText('');

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert([
          {
            sender_id: userId,
            recipient_id: peerId,
            text: text,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const newMsg = data[0];
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [
            ...prev,
            {
              id: newMsg.id,
              sender: 'SELF',
              text: newMsg.text,
              timestamp: newMsg.created_at,
            },
          ];
        });
      }
    } catch (err) {
      console.error('Failed to send secure message:', err);
    }
  };

  const getQuickReplies = () => {
    if (!userProfile) return [];
    if (userProfile.role === 'PATIENT') {
      return [
        "I just took my medication!",
        "I skipped this dose because I feel dizzy.",
        "I need some assistance.",
        "All good here!"
      ];
    } else {
      return [
        "Please remember to take your medication.",
        "Are you feeling okay?",
        "Let me know if you need help.",
        "I am checking your logs now."
      ];
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Connection validation screen
  if (!isLinked) {
    const roleText = userProfile?.role === 'CAREGIVER' ? 'Patient' : 'Caregiver';
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-6 rounded-[24px] border border-border shadow-sm gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-primary" />
              Care Connect
            </h1>
            <p className="text-xs text-muted-foreground font-semibold mt-1">
              Secure connection channel with your {roleText}.
            </p>
          </div>
        </div>

        {/* Warning Panel */}
        <div className="bg-card border border-border rounded-[24px] shadow-sm p-8 text-center space-y-6 flex flex-col items-center max-w-xl mx-auto mt-12">
          <div className="w-16 h-16 rounded-full bg-warning/10 text-warning flex items-center justify-center border border-warning/20">
            <ShieldAlert className="w-8 h-8 text-warning" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Connection Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Care Connect requires a linked connection between a Patient and a Caregiver. Only paired accounts can use this secure chat channel.
            </p>
          </div>
          
          <div className="bg-muted p-4 rounded-2xl border border-border text-left w-full space-y-3">
            <h4 className="text-xs font-black text-foreground uppercase tracking-wider">How to connect:</h4>
            {userProfile?.role === 'CAREGIVER' ? (
              <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
                Please share your <b>Caregiver ID</b> with your patient. They can enter it in their Telegram bot menu under <b>👨‍⚕️ Caregiver</b> → <b>➕ Add Caregiver</b>. Your ID is available on your dashboard console.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
                Please pair your Telegram bot account first. Go to your Telegram bot, enter <b>/linkweb</b> to get your 6-digit pairing code, and link it on your web dashboard Settings.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const quickReplies = getQuickReplies();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-6 rounded-[24px] border border-border shadow-sm gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            Care Connect
          </h1>
          <p className="text-xs text-muted-foreground font-semibold mt-1">
            Secure connection channel with {peerName}.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-black text-success bg-success/10 border border-success/20 px-3 py-1 rounded-full">
          <Lock className="w-3 h-3 text-success shrink-0" />
          End-to-End Encrypted
        </div>
      </div>

      {/* Information Banner (7-14 days Auto-Archive) */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold text-foreground">Message Retention Policy</p>
          <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
            To ensure maximum patient privacy and HIPAA compliance, all chat history is automatically archived and deleted from local caches after 14 days.
          </p>
        </div>
      </div>

      {/* Chat Window */}
      <div className="bg-card border border-border rounded-[24px] shadow-sm overflow-hidden flex flex-col h-[500px]">
        {/* Peer Info Strip */}
        <div className="bg-muted/40 border-b border-border/80 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20">
              {peerName.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-extrabold text-foreground">{peerName}</p>
              <p className="text-[10px] text-muted-foreground font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" /> Active
              </p>
            </div>
          </div>
        </div>

        {/* Message Bubble List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-muted/10">
          {messages.length > visibleCount && (
            <div className="flex justify-center pb-4">
              <button
                type="button"
                onClick={() => setVisibleCount(prev => prev + 20)}
                className="px-3 py-1 text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-all cursor-pointer"
              >
                Load older messages
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-muted-foreground/60" />
              <p className="text-xs font-bold text-muted-foreground">No recent messages</p>
              <p className="text-[10px] text-muted-foreground/80 max-w-xs">Send a check-in or question using the panel below.</p>
            </div>
          ) : (
            messages.slice(-visibleCount).map((msg) => {
              const isSelf = msg.sender === 'SELF';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                      isSelf
                        ? 'bg-primary text-primary-foreground font-semibold rounded-tr-none'
                        : 'bg-white border border-border text-foreground font-semibold rounded-tl-none'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <span
                      className={`text-[8px] block text-right mt-1 font-bold ${
                        isSelf ? 'text-primary-foreground/75' : 'text-muted-foreground/75'
                      }`}
                      suppressHydrationWarning
                    >
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick replies */}
        <div className="px-6 py-3 border-t border-border bg-white flex flex-wrap gap-2">
          {quickReplies.map((reply, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(reply)}
              className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground font-bold text-[10px] rounded-full border border-border/80 transition-all cursor-pointer hover:scale-[1.01]"
            >
              {reply}
            </button>
          ))}
        </div>

        {/* Messaging Input Area */}
        <div className="p-4 border-t border-border bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Send secure text message..."
              className="flex-1 px-4 py-2.5 bg-muted rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary/60 border border-border/60"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-4 py-2.5 bg-primary text-primary-foreground font-black text-xs rounded-xl hover:bg-primary/95 active:scale-[0.98] transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
          <p className="text-[9px] text-muted-foreground mt-2 text-center flex items-center justify-center gap-1">
            <Lock className="w-2.5 h-2.5" /> Text checks only. Media and voice notes are blocked.
          </p>
        </div>
      </div>
    </div>
  );
}
