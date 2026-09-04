/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SearchService
 * 
 * Domain service providing unified full-text and attribute search across
 * the entire virtual storage pool.
 */

import { VirtualNode } from '../../types/filesystem';
import { logger } from '../utils/logger';

export class SearchService {
  /**
   * Searches across all connected storage accounts in the virtual filesystem.
   */
  async searchVirtualFilesystem(
    _userId: string,
    query: string,
    _limit: number = 20
  ): Promise<VirtualNode[]> {
    logger.debug(`SearchService.searchVirtualFilesystem query: "${query}"`);
    // Full-text search over virtual_files table will be wired up in Phase 3
    return [];
  }
}

export const searchService = new SearchService();
