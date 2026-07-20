import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';

export interface ConversationSecurityUi {
  label: string;
  showLock: boolean;
}

export function getConversationSecurityUi(
  type: 'dm' | 'group' | undefined,
): ConversationSecurityUi | null {
  if (type === 'dm' && RIDGELINE_SECURITY_CAPABILITIES.dmE2eeSupported) {
    return { label: 'Encrypted DM', showLock: true };
  }
  if (type === 'group' && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) {
    return { label: 'Group messaging paused', showLock: false };
  }
  return null;
}
