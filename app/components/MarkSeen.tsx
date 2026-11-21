'use client';

import { useEffect } from 'react';
import { markActivitySeenAction } from '../activity-seen';

/** Renders nothing. When there is unread activity, tells the server it has now been seen (clears the tab badge). */
export function MarkSeen({ unread }: { unread: number }) {
  useEffect(() => {
    if (unread > 0) void markActivitySeenAction();
  }, [unread]);
  return null;
}
