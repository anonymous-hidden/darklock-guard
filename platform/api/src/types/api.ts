export type SecurityProfile = 'NORMAL' | 'ZERO_TRUST';

export type Role = 'device' | 'server' | 'user';

export interface AuthContext {
  deviceId?: string;
  userId?: string;
  role: Role;
  securityProfile?: SecurityProfile;
  issuedAt?: number;
}

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  api_key: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeviceRecord {
  id: string;
  security_profile: SecurityProfile;
  public_key: string | null;
  last_seen_at: string | null;
  linked_at: string | null;
  mode: 'CONNECTED' | 'LOCAL';
}

export interface DeviceCommand {
  id: string;
  device_id: string;
  command: string;
  payload: any;
  nonce: string;
  signature: string;
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'FAILED' | 'REJECTED';
  expires_at: string;
  issued_at: string;
  responded_at: string | null;
  result: any;
  error: string | null;
  response_signature: string | null;
}

export interface ReleaseRecord {
  id: number;
  product: string;
  os: string;
  channel: string;
  version: string;
  url: string;
  file_size: string | null;
  checksum: string;
  signature: string | null;
  release_notes: string | null;
  changelog: Array<{ type: string; text: string }>;
  created_at: string;
}
