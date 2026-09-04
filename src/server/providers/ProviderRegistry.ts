/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Provider Registry
 * Resolves StorageProvider instances by provider type.
 */

import { ProviderType } from '../../types/account';
import { StorageProvider } from '../../types/provider';
import { GoogleDriveProvider } from './GoogleDriveProvider';
import { AppError } from '../utils/errors';
import { ErrorCode } from '../../types/api';

export class ProviderRegistry {
  private static providers: Map<ProviderType, StorageProvider> = new Map([
    [ProviderType.GOOGLE_DRIVE, new GoogleDriveProvider()],
  ]);

  public static get(providerType: ProviderType): StorageProvider {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `Storage provider '${providerType}' is not supported or registered.`
      );
    }
    return provider;
  }

  public static register(provider: StorageProvider): void {
    this.providers.set(provider.providerType, provider);
  }

  public static supportedProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }
}
