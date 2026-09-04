/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud FileService
 * 
 * Domain service managing virtual files, metadata queries, and star/trash actions.
 */

import { VirtualFile, FileFilterOptions } from '../../types/filesystem';
import { AppError } from '../utils/errors';
import { ErrorCode } from '../../types/api';
import { logger } from '../utils/logger';

export class FileService {
  /**
   * Retrieves virtual files in a specific folder.
   */
  async getFilesInFolder(
    _userId: string,
    _folderId: string | null,
    _filter?: FileFilterOptions
  ): Promise<VirtualFile[]> {
    logger.debug('FileService.getFilesInFolder called');
    return [];
  }

  /**
   * Retrieves a single virtual file by UniCloud virtual ID.
   */
  async getFileById(_userId: string, fileId: string): Promise<VirtualFile> {
    logger.debug(`FileService.getFileById ${fileId}`);
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `FileService.getFileById is scheduled for Phase 3.`
    );
  }

  /**
   * Toggles favorite/star status on a virtual file.
   */
  async toggleStarred(_userId: string, _fileId: string): Promise<boolean> {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `FileService.toggleStarred is scheduled for Phase 3.`
    );
  }

  /**
   * Soft-deletes a virtual file into the virtual trash.
   */
  async moveToTrash(_userId: string, _fileId: string): Promise<void> {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `FileService.moveToTrash is scheduled for Phase 3.`
    );
  }
}

export const fileService = new FileService();
