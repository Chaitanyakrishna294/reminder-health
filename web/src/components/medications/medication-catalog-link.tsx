'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { searchMedicationCatalog, type CatalogLinkValue, type CatalogSearchResult } from '@/lib/medications/catalog';
import { Search, X, ShieldAlert } from 'lucide-react';

interface MedicationCatalogLinkProps {
  value: CatalogLinkValue | null;
  onChange: (value: CatalogLinkValue | null) => void;
}

function toLinkValue(row: CatalogSearchResult): CatalogLinkValue {
  return {
    catalogId: row.id,
    brandName: row.brand_name,
    composition: row.composition_text,
    manufacturer: row.manufacturer_name,
    isDiscontinued: row.is_discontinued,
    snapshotDate: row.snapshot_date,
  };
}

export default function MedicationCatalogLink({ value, onChange }: MedicationCatalogLinkProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const rows = await searchMedicationCatalog(supabase, query.trim());
      setResults(rows);
      setSearching(false);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  if (value) {
    return (
      <div className="mt-2 flex items-start justify-between gap-3 rounded-2xl bg-[#F2F2F7] px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground truncate">
            Linked: {value.brandName}
            {value.isDiscontinued && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground align-middle">
                <ShieldAlert className="w-3 h-3" /> Discontinued
              </span>
            )}
          </p>
          {value.composition && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{value.composition}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Patient-selected from catalog · as of {value.snapshotDate}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Remove catalog link"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary"
      >
        <Search className="w-3.5 h-3.5" /> Link to real medication (optional)
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand name, e.g. Augmentin"
          autoFocus
          className="flex-1 rounded-2xl bg-[#F2F2F7] px-3.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(''); setResults([]); }}
          className="text-xs font-semibold text-muted-foreground"
        >
          Cancel
        </button>
      </div>

      {searching && <p className="text-[11px] text-muted-foreground">Searching...</p>}

      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No match found — you can leave this unlinked.</p>
      )}

      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-2xl border border-border divide-y divide-border">
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => { onChange(toLinkValue(row)); setOpen(false); setQuery(''); setResults([]); }}
              className="w-full text-left px-3.5 py-2.5 hover:bg-muted/50"
            >
              <p className="text-xs font-bold text-foreground truncate">
                {row.brand_name}
                {row.is_discontinued && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground align-middle">
                    Discontinued
                  </span>
                )}
              </p>
              {row.composition_text && (
                <p className="text-[11px] text-muted-foreground truncate">{row.composition_text}</p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {row.manufacturer_name}{row.pack_size_label ? ` · ${row.pack_size_label}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
