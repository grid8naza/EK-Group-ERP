'use client';

import { MessageCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChatScreen } from '@/components/workplace/ChatScreen';

/**
 * Chat — the Workplace module's instant messaging (SRS §8.11, FR-COM-02).
 *
 * The screen owns the full height below the header: a messenger reads bottom-up
 * from a fixed frame, so the thread scrolls inside the page rather than the page
 * scrolling around it.
 */
export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Chat"
        description="Message anyone you work with, one to one or in a group"
        icon={<MessageCircle className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <ChatScreen />
      </div>
    </div>
  );
}
