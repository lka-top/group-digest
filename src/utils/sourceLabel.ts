export interface SourceIdentity {
  platform?: string | null;
  platform_account_id?: string | null;
  account_self_id?: string | null;
  account_display_name?: string | null;
  platform_group_id?: string | null;
  group_name?: string | null;
  name?: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  qq: 'QQ',
};

export function platformLabel(platform?: string | null): string {
  if (!platform) return '未知平台';
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

export function accountLabel(source: SourceIdentity): string {
  const displayName = source.account_display_name?.trim();
  const selfId = source.account_self_id?.trim();
  if (displayName && selfId && displayName !== selfId) return `${displayName}（${selfId}）`;
  return displayName || selfId || '未识别账号';
}

export function groupLabel(source: SourceIdentity): string {
  const name = source.group_name?.trim() || source.name?.trim() || '未知群聊';
  const groupId = source.platform_group_id?.trim();
  return groupId ? `${name}（${groupId}）` : name;
}

export function accountSourceLabel(source: SourceIdentity): string {
  return `${platformLabel(source.platform)} · ${accountLabel(source)}`;
}
