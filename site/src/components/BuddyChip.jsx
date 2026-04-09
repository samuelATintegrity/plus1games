// BuddyChip — floating overlay visible whenever a buddy pass is active.
// Shows local nickname, connection status, the remote buddy's name, a share
// button, and a leave button. Rendered by <Layout> as a fixed overlay so
// it persists across all routes.

import { useEffect, useState } from 'react';
import { useBuddy } from '../multiplayer/BuddyProvider.jsx';

export default function BuddyChip() {
  const buddy = useBuddy();
  const [showShare, setShowShare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!buddy.isActive && !buddy.isFull) return null;

  // Remote name (first other player, if any)
  let remoteName = null;
  for (const [, r] of buddy.remotePlayers) { remoteName = r.nickname; break; }

  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col items-end gap-2">
      {buddy.isFull && (
        <div className="px-3 py-1 text-[10px] bg-gb-darkest text-gb-lightest border border-gb-light">
          THIS BUDDY PASS IS FULL
        </div>
      )}

      {buddy.isActive && (
        <div className="flex items-center gap-2 px-2 py-1 bg-gb-darkest text-gb-lightest border border-gb-light text-[10px]">
          {/* Local nickname (editable) */}
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 16))}
              onBlur={() => { buddy.setNickname(draft); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { buddy.setNickname(draft); setEditing(false); }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-16 bg-gb-dark text-gb-lightest border border-gb-light px-1 text-[10px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setDraft(buddy.nickname); setEditing(true); }}
              title="Edit nickname"
              className="hover:text-gb-light"
            >
              {buddy.nickname}
            </button>
          )}

          <span className="text-gb-light">·</span>

          {/* Connection + remote name */}
          <span className="flex items-center gap-1">
            <Dot connected={buddy.isConnected && !!remoteName} />
            <span>{remoteName || (buddy.isConnected ? 'waiting...' : 'connecting...')}</span>
          </span>

          <span className="text-gb-light">·</span>

          <button
            type="button"
            onClick={() => setShowShare((v) => !v)}
            className="underline underline-offset-2 hover:text-gb-light"
          >
            SHARE
          </button>

          <button
            type="button"
            onClick={() => buddy.leaveBuddyPass()}
            className="underline underline-offset-2 hover:text-gb-light"
          >
            LEAVE
          </button>
        </div>
      )}

      {buddy.isActive && showShare && (
        <SharePopover
          url={buddy.shareUrl}
          code={buddy.shareCode}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}

function Dot({ connected }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: connected ? '#9bbc0f' : '#306230' }}
    />
  );
}

function SharePopover({ url, code, onClose }) {
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(''), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async (what, value) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); } catch {}
  };

  return (
    <div className="w-72 p-3 bg-gb-darkest text-gb-lightest border border-gb-light text-[10px] flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="tracking-widest">INVITE A BUDDY</span>
        <button onClick={onClose} className="hover:text-gb-light">×</button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gb-light">CODE</span>
        <div className="flex items-center justify-between bg-gb-dark border border-gb-light px-2 py-1">
          <span className="tracking-[0.3em] text-sm">{code}</span>
          <button onClick={() => copy('code', code)} className="hover:text-gb-light">
            {copied === 'code' ? 'COPIED' : 'COPY'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gb-light">LINK</span>
        <div className="flex items-center justify-between bg-gb-dark border border-gb-light px-2 py-1 gap-2">
          <span className="truncate">{url}</span>
          <button onClick={() => copy('url', url)} className="hover:text-gb-light shrink-0">
            {copied === 'url' ? 'COPIED' : 'COPY'}
          </button>
        </div>
      </div>
    </div>
  );
}
