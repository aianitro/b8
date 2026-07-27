'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';

type Account = { id: string; name: string; landscape: string };
type ParsedRow = { date: string; description: string; amount: number };
type ParseState = { rows: ParsedRow[]; fileName: string; minDate: string; maxDate: string } | null;
type ResultState = { imported: number; skipped: number } | null;

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));

const stripCurrency = (s: string) => parseFloat(s.replace(/[$,]/g, '').trim());

function parseChaseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const dateIdx = header.findIndex((h) => h === 'Transaction Date' || h === 'Posting Date');
  const descIdx = header.findIndex((h) => h === 'Description');
  const amtIdx  = header.findIndex((h) => h === 'Amount');
  if (dateIdx < 0 || descIdx < 0 || amtIdx < 0) return [];

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
    if (cols.length <= amtIdx) continue;
    const [m, d, y] = cols[dateIdx].split('/');
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const chaseAmount = parseFloat(cols[amtIdx]);
    if (isNaN(chaseAmount)) continue;
    // Chase: negative = purchase → store as positive; positive = credit → store as negative
    rows.push({ date, description: cols[descIdx], amount: -chaseAmount });
  }
  return rows;
}

function parseDiscoverCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const dateIdx   = header.findIndex((h) => h === 'Transaction Date');
  const descIdx   = header.findIndex((h) => h === 'Transaction Description');
  const debitIdx  = header.findIndex((h) => h === 'Debit');
  const creditIdx = header.findIndex((h) => h === 'Credit');
  if (dateIdx < 0 || descIdx < 0 || debitIdx < 0 || creditIdx < 0) return [];

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
    if (cols.length <= creditIdx) continue;
    const [m, d, y] = cols[dateIdx].split('/');
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const debit  = stripCurrency(cols[debitIdx]);
    const credit = stripCurrency(cols[creditIdx]);
    let amount: number;
    if (!isNaN(debit) && debit > 0) {
      amount = debit;   // money out → positive expense
    } else if (!isNaN(credit) && credit > 0) {
      amount = -credit; // money in → negative (income/credit)
    } else {
      continue;
    }
    rows.push({ date, description: cols[descIdx], amount });
  }
  return rows;
}

// Handles quoted CSV values (fields may contain commas inside quotes)
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      result.push(end < 0 ? line.slice(i + 1) : line.slice(i + 1, end));
      i = end < 0 ? line.length : end + 2;
    } else {
      const end = line.indexOf(',', i);
      if (end < 0) { result.push(line.slice(i)); break; }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

// JP Morgan brokerage (Self-Directed / Trust accounts)
// Skips internal money-market sweeps (DBS/WDL) and reinvested interest (Reinvest)
function parseJPMorganCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const dateIdx = header.findIndex((h) => h === 'Trade Date');
  const typeIdx = header.findIndex((h) => h === 'Type');
  const descIdx = header.findIndex((h) => h === 'Description');
  const amtIdx  = header.findIndex((h) => h === 'Amount USD');
  if (dateIdx < 0 || typeIdx < 0 || descIdx < 0 || amtIdx < 0) return [];

  // Internal sweep / offset entries — not real cash flows
  const SKIP = new Set(['DBS', 'WDL', 'Reinvest']);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length <= amtIdx) continue;
    const type = cols[typeIdx].trim();
    if (SKIP.has(type)) continue;
    const [m, d, y] = cols[dateIdx].split('/');
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const amtUSD = stripCurrency(cols[amtIdx]);
    if (isNaN(amtUSD) || amtUSD === 0) continue;
    // JP Morgan: positive = money in → store negative; negative = money out → store positive
    rows.push({ date, description: `[${type}] ${cols[descIdx].trim()}`, amount: -amtUSD });
  }
  return rows;
}

function parseCSV(text: string): ParsedRow[] {
  const jpRows = parseJPMorganCSV(text);
  if (jpRows.length > 0) return jpRows;
  const discoverRows = parseDiscoverCSV(text);
  if (discoverRows.length > 0) return discoverRows;
  const chaseRows = parseChaseCSV(text);
  if (chaseRows.length > 0) return chaseRows;
  throw new Error('Unrecognised CSV format — expected Chase, Discover, or JP Morgan columns');
}

interface Props { accounts: Account[] }

export default function CsvImporter({ accounts }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState('');
  const [parsed, setParsed] = useState<ParseState>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultState>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setParsed(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        if (rows.length === 0) { setError('No transactions found in file.'); return; }
        const dates = rows.map((r) => r.date).sort();
        setParsed({ rows, fileName: file.name, minDate: dates[0], maxDate: dates[dates.length - 1] });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!accountId || !parsed) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, rows: parsed.rows }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error?.message ?? 'Import failed'); return; }
      setResult(data.data);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setParsed(null); setResult(null); setError(null); setAccountId('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Account selector */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">1 · Select account</h2>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        >
          <option value="">Choose account…</option>
          {(['operational', 'capital'] as const).map((ls) => {
            const group = accounts.filter((a) => a.landscape === ls);
            if (group.length === 0) return null;
            return (
              <optgroup key={ls} label={ls.charAt(0).toUpperCase() + ls.slice(1)}>
                {group.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            );
          })}
        </select>
      </div>

      {/* File picker */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">2 · Choose CSV file</h2>
        <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-200 rounded-xl p-8 cursor-pointer hover:border-slate-300 hover:bg-slate-50/50 transition-colors">
          <Upload size={22} className="text-slate-400" />
          <span className="text-sm text-slate-500">
            {parsed ? parsed.fileName : 'Click to select CSV export (Chase, Discover, or JP Morgan)'}
          </span>
          <input ref={fileRef} type="file" accept=".csv,.CSV" className="sr-only" onChange={handleFile} />
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Preview */}
      {parsed && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileText size={15} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{parsed.rows.length} transactions</span>
              <span className="text-xs text-slate-400">{parsed.minDate} → {parsed.maxDate}</span>
            </div>
            {result && (
              <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                <CheckCircle2 size={15} />
                {result.imported} imported{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}
              </div>
            )}
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Description</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-xs font-mono text-slate-400 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-2.5 text-slate-700 truncate max-w-xs">{r.description}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-sm font-medium ${r.amount < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {r.amount < 0 ? '+' : ''}{fmt(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 8 && (
              <p className="px-5 py-2.5 text-xs text-slate-400 border-t border-slate-50">
                …and {parsed.rows.length - 8} more
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
              Clear
            </button>
            <button
              onClick={handleImport}
              disabled={!accountId || loading || !!result}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Importing…' : result ? 'Done' : `Import ${parsed.rows.length} transactions`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
