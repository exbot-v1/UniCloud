/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud FolderService
 * 
 * Domain service managing virtual folders, directory hierarchy, and breadcrumb trees.
 */

import { VirtualFolder, BreadcrumbItem } from '../../types/filesystem.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';

export class FolderService {
  /**
   * Retrieves subfolders within a parent folder.
   */
  async getFoldersInFolder(_userId: string, _parentId: string | null): Promise<VirtualFolder[]> {
    return [];
  }

  /**
   * Resolves breadcrumb hierarchy from root to current folder.
   */
  async getBreadcrumbs(_userId: string, folderId: string | null): Promise<BreadcrumbItem[]> {
    const crumbs: BreadcrumbItem[] = [{ id: null, name: 'Home' }];
    if (!folderId) {
      return crumbs;
    }
    // Folder ancestry resolution will query the database in Phase 3
    return crumbs;
  }

  /**
   * Creates a new virtual folder.
   */
  async createFolder(_userId: string, _name: string, _parentId: string | null): Promise<VirtualFolder> {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `FolderService.createFolder is scheduled for Phase 3.`
    );
  }
}

export const folderService = new FolderService();
