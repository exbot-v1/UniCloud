/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Authentication & User Types
 */

export interface UserPublicProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface UserSessionData {
  user: UserPublicProfile;
  sessionToken: string;
  expiresAt: Date;
}
