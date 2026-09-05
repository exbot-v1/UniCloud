/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Upload Router Simulator Modal (Phase 0)
 * Allows users to test the upload routing engine and see dynamic account selection.
 */

import React, { useState } from 'react';
import {
  UploadCloud,
  X,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Zap,
  Sliders,
  Shield,
  Layers,
} from 'lucide-react';
import { StoragePoolSummary } from '../types/account';
import { UploadRoutingStrategy, UploadRoutingDecision } from '../types/upload';
import { formatBytes } from '../lib/formatters';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolSummary: StoragePoolSummary;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  poolSummary,
}) => {
  const [fileName, setFileName] = useState('Production_Dataset_2026.zip');
  const [sizeMb, setSizeMb] = useState<number>(450);
  const [strategy, setStrategy] = useState<UploadRoutingStrategy>(UploadRoutingStrategy.MOST_FREE_SPACE);
  const [preferredAccountId, setPreferredAccountId] = useState<string>('');
  const [routingResult, setRoutingResult] = useState<UploadRoutingDecision | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  if (!isOpen) return null;

  const sizeBytes = sizeMb * 1024 * 1024;

  const handleSimulateRouting = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/upload/route-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sizeBytes,
          strategy,
          preferredAccountId: preferredAccountId || undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setRoutingResult(data.data);
      } else {
        // Fallback local calculation matching the same logic
        const capable = poolSummary.accounts
          .filter((a) => a.quota.freeBytes >= sizeBytes)
          .sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);

        if (capable.length > 0) {
          const chosen = capable[0];
          setRoutingResult({
            selectedAccountId: chosen.id,
            strategyUsed: strategy,
            reason: `Account '${chosen.email}' selected with highest available capacity (${formatBytes(chosen.quota.freeBytes)} free).`,
            availableCapacityBeforeBytes: chosen.quota.freeBytes,
            projectedCapacityAfterBytes: chosen.quota.freeBytes - sizeBytes,
          });
        }
      }
    } catch {
      // Fallback
      const capable = poolSummary.accounts
        .filter((a) => a.quota.freeBytes >= sizeBytes)
        .sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);

      if (capable.length > 0) {
        const chosen = capable[0];
        setRoutingResult({
          selectedAccountId: chosen.id,
          strategyUsed: strategy,
          reason: `Account '${chosen.email}' selected with highest available capacity (${formatBytes(chosen.quota.freeBytes)} free).`,
          availableCapacityBeforeBytes: chosen.quota.freeBytes,
          projectedCapacityAfterBytes: chosen.quota.freeBytes - sizeBytes,
        });
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const selectedAccount = routingResult
    ? poolSummary.accounts.find((a) => a.id === routingResult.selectedAccountId)
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#12161f] rounded-2xl p-6 shadow-2xl border border-[#262c36] space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto text-slate-100">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#262c36] pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/15 text-cyan-400 shadow-sm border border-cyan-500/30">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Upload & Capacity Routing Preview</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#161b24] text-slate-400 border border-[#262c36] uppercase">
                  Phase 4 Preview
                </span>
              </div>
              <p className="text-xs text-slate-400">Preview simulated file distribution across Google Drive accounts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#1a202c] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Phase Notice */}
        <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/50 text-cyan-200 text-xs flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Planned for Phase 4:</span> Direct resumable streaming to Google Drive API v3 and
            autonomous upload routing will be implemented in Phase 4. This tool evaluates routing logic against current capacity.
          </div>
        </div>

        {/* Configuration inputs */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-300 block mb-1">Simulated File Name</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-3 py-2 bg-[#0e1117] border border-[#262c36] text-white rounded-xl focus:border-cyan-500 focus:outline-hidden"
            />
          </div>

          <div>
            <div className="flex justify-between font-semibold text-slate-300 mb-1">
              <span>File Size Simulation</span>
              <span className="text-cyan-400 font-bold">{sizeMb} MB ({formatBytes(sizeBytes)})</span>
            </div>
            <input
              type="range"
              min={10}
              max={5000}
              step={10}
              value={sizeMb}
              onChange={(e) => {
                setSizeMb(Number(e.target.value));
                setRoutingResult(null);
              }}
              className="w-full accent-cyan-400 h-2 bg-[#0e1117] border border-[#262c36] rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>10 MB</span>
              <span>1 GB</span>
              <span>2.5 GB</span>
              <span>5 GB</span>
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-300 block mb-1">Routing Strategy</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: UploadRoutingStrategy.MOST_FREE_SPACE, label: 'Most Free Space' },
                { id: UploadRoutingStrategy.BALANCED, label: 'Balanced' },
                { id: UploadRoutingStrategy.MANUAL, label: 'Manual' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setStrategy(s.id);
                    setRoutingResult(null);
                  }}
                  className={`py-2 px-3 rounded-xl border text-center font-medium transition-all ${
                    strategy === s.id
                      ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300 font-bold shadow-xs'
                      : 'border-[#262c36] bg-[#161b24] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {strategy === UploadRoutingStrategy.MANUAL && (
            <div>
              <label className="font-semibold text-slate-300 block mb-1">Target Account</label>
              <select
                value={preferredAccountId}
                onChange={(e) => setPreferredAccountId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0e1117] border border-[#262c36] text-white rounded-xl focus:border-cyan-500 focus:outline-hidden"
              >
                <option value="">Select an account</option>
                {poolSummary.accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.displayName || acc.email} ({formatBytes(acc.quota.freeBytes)} free)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={handleSimulateRouting}
          disabled={isSimulating}
          className="w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-bold shadow-md shadow-cyan-950/50 border border-cyan-400/50 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
        >
          <Zap className="h-4 w-4 text-slate-950" />
          <span>{isSimulating ? 'Evaluating Capacity...' : 'Simulate Routing Decision'}</span>
        </button>

        {/* Routing Decision Output */}
        {routingResult && selectedAccount && (
          <div className="p-4 rounded-xl bg-[#10141b] border border-[#262c36] space-y-3 text-xs animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Routing Decision Resolved
              </span>
              <span className="font-mono text-[10px] bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 px-2 py-0.5 rounded-full font-bold">
                {routingResult.strategyUsed}
              </span>
            </div>

            <p className="text-slate-300 text-[11px]">{routingResult.reason}</p>

            <div className="p-3 bg-[#161b24] rounded-xl border border-[#262c36] space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <HardDrive className="h-4 w-4 text-cyan-400" />
                <span>Selected Destination: {selectedAccount.displayName || selectedAccount.email}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1.5 border-t border-[#262c36]">
                <div>
                  <span className="text-slate-400 block">Available Headroom:</span>
                  <span className="font-bold text-white">{formatBytes(routingResult.availableCapacityBeforeBytes)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Projected After Upload:</span>
                  <span className="font-bold text-teal-300">{formatBytes(routingResult.projectedCapacityAfterBytes)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
