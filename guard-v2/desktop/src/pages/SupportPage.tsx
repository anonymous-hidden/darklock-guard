import React, { useState } from 'react';
import { useService } from '../state/service';
import { invoke } from '@tauri-apps/api/core';
import {
  LifeBuoy, BookOpen, Bug, Download, ExternalLink, MessageCircle, FileText,
  Terminal, Copy, Check, Shield, Cpu, HardDrive, Monitor, Clock, Loader2
} from 'lucide-react';

const PLATFORM_BASE = 'https://darklock.net';

const SupportPage: React.FC = () => {
  const { serviceAvailable, status } = useService();
  const [copied, setCopied] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportText, setReportText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const sysInfo = [
    { icon: Shield, label: 'Version', value: 'v2.0.0' },
    { icon: Monitor, label: 'Platform', value: navigator.platform || 'Linux x86_64' },
    { icon: Cpu, label: 'Service', value: serviceAvailable ? 'Running' : 'Unavailable' },
    { icon: HardDrive, label: 'Mode', value: status?.mode || 'Offline' },
    { icon: Clock, label: 'Uptime', value: status?.uptime ? `${Math.round(status.uptime / 60)}m` : 'N/A' },
    { icon: FileText, label: 'Vault Format', value: 'DLOCK02' },
  ];

  const diagnosticText = sysInfo.map(s => `${s.label}: ${s.value}`).join('\n') + `\nTimestamp: ${new Date().toISOString()}\nUser-Agent: ${navigator.userAgent}`;

  const copyDiagnostics = () => {
    navigator.clipboard?.writeText(diagnosticText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportDiagnostics = () => {
    const blob = new Blob([diagnosticText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `darklock-diagnostics-${Date.now()}.txt`;
    a.click();
  };

  const links = [
    { icon: BookOpen, label: 'Documentation', desc: 'Setup guides and configuration reference', url: `${PLATFORM_BASE}/docs` },
    { icon: MessageCircle, label: 'Community Discord', desc: 'Get help from the community', url: 'https://discord.gg/darklock' },
    { icon: Bug, label: 'Report a Bug', desc: 'Submit an issue on GitHub', url: 'https://github.com/darklock-org/guard/issues' },
    { icon: FileText, label: 'Changelog', desc: 'View release notes and version history', url: `${PLATFORM_BASE}/changelog` },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Support</h1>
        <p className="text-sm text-text-muted mt-0.5">Diagnostics, documentation, and help resources</p>
      </div>

      {/* System Diagnostics */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-accent-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">System Diagnostics</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={copyDiagnostics} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary border border-white/5 text-xs text-text-secondary hover:bg-bg-secondary/80 transition-colors">
              {copied ? <Check size={12} className="text-semantic-success" /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={exportDiagnostics} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/30 text-xs text-accent-primary hover:bg-accent-primary/20 transition-colors">
              <Download size={12} /> Export
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {sysInfo.map(info => (
            <div key={info.label} className="flex items-center gap-2.5 bg-bg-secondary/40 rounded-lg p-3">
              <info.icon size={14} className="text-text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-text-muted">{info.label}</p>
                <p className="text-sm font-mono truncate">{info.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <LifeBuoy size={16} className="text-accent-secondary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Resources</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {links.map(link => (
            <a
              key={link.label}
              href={link.url}
              className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/30 border border-white/5 hover:border-white/10 hover:bg-bg-secondary/50 transition-all group"
            >
              <div className="p-2 rounded-lg bg-bg-secondary">
                <link.icon size={16} className="text-text-secondary group-hover:text-accent-primary transition-colors" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{link.label}</p>
                <p className="text-[11px] text-text-muted">{link.desc}</p>
              </div>
              <ExternalLink size={12} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          ))}
        </div>
      </div>

      {/* Bug Report */}
      <div className="bg-bg-card border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bug size={16} className="text-semantic-warning" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Report an Issue</h2>
        </div>
        {reportSent ? (
          <div className="text-center py-6">
            <Check size={32} className="text-semantic-success mx-auto mb-2" />
            <p className="text-sm font-semibold">Report submitted!</p>
            <p className="text-xs text-text-muted mt-1">Thank you for helping improve Darklock Guard</p>
            <button onClick={() => { setReportSent(false); setReportText(''); }} className="mt-3 text-xs text-accent-primary hover:underline">Submit another report</button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={reportText}
              onChange={e => setReportText(e.target.value)}
              placeholder="Describe the issue you encountered..."
              className="w-full bg-bg-secondary/50 border border-white/5 rounded-lg p-3 text-sm min-h-[100px] placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 resize-none"
            />
            {submitError && <p className="text-xs text-semantic-error">{submitError}</p>}
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-text-muted">System diagnostics will be attached automatically</p>
              <button
                onClick={async () => {
                  if (!reportText.trim()) { setSubmitError('Please describe the issue before submitting.'); return; }
                  setSubmitting(true);
                  setSubmitError('');
                  try {
                    // Send bug report to public endpoint (no auth required)
                    const report = {
                      source: 'guard_desktop',
                      reporter: 'Guard User',
                      title: `Bug Report - ${new Date().toLocaleString()}`,
                      description: reportText.trim(),
                      severity: 'medium',
                      app_version: 'v2.0.0',
                      environment: 'production',
                      logs: diagnosticText,
                    };
                    
                    const response = await fetch('https://darklock.net/api/v4/admin/bug-reports/submit', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(report),
                    });
                    
                    if (!response.ok) {
                      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                    }
                    
                    const result = await response.json();
                    if (!result.success) {
                      throw new Error(result.error || 'Failed to submit report');
                    }
                    
                    setReportSent(true);
                  } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'Failed to submit report';
                    setSubmitError(`${errorMessage}. Please check that the Darklock server is running on port 3002.`);
                  }
                  setSubmitting(false);
                }}
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-primary/20 border border-accent-primary/40 text-sm text-accent-primary hover:bg-accent-primary/30 transition-colors font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Bug size={14} />}
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Beta Notice */}
      <div className="bg-semantic-warning/5 border border-semantic-warning/20 rounded-xl p-4 flex items-start gap-3">
        <Shield size={18} className="text-semantic-warning mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-semantic-warning">Beta Software</p>
          <p className="text-xs text-text-muted mt-0.5">
            Darklock Guard v2 is in active development. Some features may be incomplete or change before release.
            Please report bugs to help us improve.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SupportPage;
