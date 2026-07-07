import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const NEVER_KEY = 'peekmd-skill-prompt-never';

type SkillStatus = {
  agent_detected: boolean;
  skill_installed: boolean;
  agents: { name: string; binary: string }[];
};

export function SkillPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [state, setState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const install = async () => {
    setState('installing');
    try {
      const result = await invoke<string>('install_agent_skill');
      setMsg(result);
      setState('done');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  const never = () => {
    localStorage.setItem(NEVER_KEY, '1');
    onDismiss();
  };

  return (
    <div className="peekmd-skill-prompt" role="dialog" aria-label="Install agent skill">
      {state === 'idle' && (
        <button
          type="button"
          className="peekmd-skill-prompt-close"
          aria-label="Dismiss"
          onClick={onDismiss}
        >×</button>
      )}
      <div className="peekmd-skill-prompt-body">
        {state === 'idle' && (
          <>
            <span className="peekmd-skill-prompt-text">
              Install the PeekMD skill so your AI coding agent can open and query files for you?
            </span>
            <div className="peekmd-skill-prompt-actions">
              <button
                type="button"
                className="peekmd-skill-prompt-btn peekmd-skill-prompt-btn-primary"
                onClick={install}
              >
                Install skill
              </button>
              <button type="button" className="peekmd-skill-prompt-btn" onClick={onDismiss}>
                Later
              </button>
              <button type="button" className="peekmd-skill-prompt-btn peekmd-skill-prompt-btn-never" onClick={never}>
                Never
              </button>
            </div>
          </>
        )}
        {state === 'installing' && (
          <span className="peekmd-skill-prompt-text">Installing…</span>
        )}
        {state === 'done' && (
          <>
            <span className="peekmd-skill-prompt-text">✓ {msg}</span>
            <button type="button" className="peekmd-skill-prompt-btn" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
        {state === 'error' && (
          <>
            <span className="peekmd-skill-prompt-text peekmd-skill-prompt-error">{msg}</span>
            <button type="button" className="peekmd-skill-prompt-btn" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Call once at startup in the main window. Returns true if prompt should show.
export async function checkSkillPrompt(): Promise<boolean> {
  if (localStorage.getItem(NEVER_KEY)) return false;
  try {
    const status = await invoke<SkillStatus>('skill_install_status');
    return status.agent_detected && !status.skill_installed;
  } catch {
    return false;
  }
}
